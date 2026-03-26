# Plan: Apply GrpcAuthInterceptor

## Context
Wire up the existing `GrpcAuthInterceptor` on all gRPC controllers — per-method on `AuthGrpcController` (mixed public/protected), class-level on the rest — and replace all inline token-extraction/session-validation boilerplate with `@GrpcCurrentUser()`, `@GrpcOptionalAuth()`, and a new `@GrpcToken()` decorator.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Missing decorator

- [x] **Task 1: Create `@GrpcToken()` param decorator**
  Files: `src/grpc/decorators/grpc-token.decorator.ts`, `src/grpc/decorators/index.ts`
  The `logout` method needs the raw JWT string to call `sessionService.revoke(token)`. The interceptor already stores it on `metadata[GRPC_TOKEN_KEY]`, but there is no decorator to read it.
  Create `grpc-token.decorator.ts` following the exact pattern from `grpc-current-user.decorator.ts`: use `createParamDecorator`, call `ctx.switchToRpc().getContext<Metadata>()`, read `(metadata as any)[GRPC_TOKEN_KEY]`, return `string | null`.
  Export from `src/grpc/decorators/index.ts` alongside the existing re-exports.

### Phase 2: Auth controller (mixed public/protected)

- [x] **Task 2: Wire interceptor on `AuthGrpcController`** (depends on Task 1)
  Files: `src/users/auth.grpc.controller.ts`
  This controller has 3 public methods (`sendCode`, `verifyCode`, `googleAuth`) and 4 protected methods — the interceptor must be applied **per-method**, not at class level.
  For each protected method:
  - `logout` — add `@UseInterceptors(GrpcAuthInterceptor)`, replace `metadata` parameter with `@GrpcToken() token: string` param, remove the inline token-extraction block (lines 80-87), call `sessionService.revoke(token)` directly. Keep `SessionService` in the constructor — it's still needed for `revoke()`.
  - `createToken` — add `@UseInterceptors(GrpcAuthInterceptor)`, replace the current `user?: JwtPayload` parameter with `@GrpcCurrentUser() user: JwtPayload`, remove the `if (!user)` guard block (the interceptor rejects unauthenticated calls before the method runs).
  - `listTokens` — same as `createToken`.
  - `deleteToken` — same as `createToken`.
  Uncomment the import lines for `GrpcAuthInterceptor` and `GrpcCurrentUser`, add imports for `UseInterceptors`, `GrpcToken`. Remove only imports that are no longer used after the refactor — all uses of `RpcException`, `GrpcStatus`, and `Metadata` in this controller are auth boilerplate being removed, so all three can go.

### Phase 3: Remaining controllers

- [x] **Task 3: Wire interceptor on `BreathSessionsGrpcController`** (depends on Task 1)
  Files: `src/breath-sessions/breath-sessions.grpc.controller.ts`
  All 9 methods need the interceptor (some required, some optional) so apply `@UseInterceptors(GrpcAuthInterceptor)` at the **class level**.
  Changes:
  - Add class-level `@UseInterceptors(GrpcAuthInterceptor)`.
  - Delete the `extractUser()` and `extractOptionalUser()` private helper methods entirely.
  - On optional-auth methods (`listSessions`, `batchGetSessions`, `getSession`): add `@GrpcOptionalAuth()` decorator on the method, replace `metadata?: Metadata` parameter with `@GrpcCurrentUser() user: JwtPayload | null`, use `user?.sub ?? null` instead of calling `extractOptionalUser`.
  - On required-auth methods (`createSession`, `getSuggestions`, `updateSession`, `replaceSession`, `updateSessionSettings`, `deleteSession`): replace `metadata?: Metadata` parameter with `@GrpcCurrentUser() user: JwtPayload`, use `user.sub` directly.
  - Remove `JwtService` and `SessionService` from the constructor — they are no longer used directly (the interceptor resolves them from DI on its own).
  - Clean up imports: remove only imports that are no longer used after the refactor. `RpcException` and `GrpcStatus` must be **kept** — `batchGetSessions` still uses them for input validation (`INVALID_ARGUMENT`). Remove `Metadata`, `JwtService`, `SessionService`. Add `UseInterceptors`, `GrpcAuthInterceptor`, `GrpcCurrentUser`, `GrpcOptionalAuth`.

- [x] **Task 4: Wire interceptor on `UsersGrpcController`, `StatsGrpcController`, `SyncGrpcController`**
  Files: `src/users/users.grpc.controller.ts`, `src/stats/stats.grpc.controller.ts`, `src/sync/sync.grpc.controller.ts`
  All methods in these three controllers require authentication, so apply `@UseInterceptors(GrpcAuthInterceptor)` at the **class level** on each.
  For each controller, the change is identical in shape:
  - Add class-level `@UseInterceptors(GrpcAuthInterceptor)`.
  - Replace `metadata?: Metadata` parameter with `@GrpcCurrentUser() user: JwtPayload`, use `user.sub` directly instead of the inline extraction block.
  - Remove `JwtService` and `SessionService` from the constructor.
  - Add imports for `UseInterceptors`, `GrpcAuthInterceptor`, `GrpcCurrentUser`.
  - Remove only imports that are no longer used after the refactor. Each controller has a different surviving set:
    - **`UsersGrpcController`**: keep `RpcException` and `GrpcStatus` — `updateProfile` still uses them for input validation (`INVALID_ARGUMENT` for name length and language whitelist). Remove `Metadata`, `JwtService`, `SessionService`.
    - **`StatsGrpcController`**: all uses of `RpcException`, `GrpcStatus`, and `Metadata` are auth boilerplate — remove all three plus `JwtService`, `SessionService`.
    - **`SyncGrpcController`**: keep `RpcException`, `GrpcStatus`, **and** `Metadata` — `watchChanges` is an `UNIMPLEMENTED` stub that uses all three. Remove `JwtService`, `SessionService`.
  - `SyncGrpcController.watchChanges` is currently an `UNIMPLEMENTED` stub — leave as-is, the class-level interceptor will pre-validate the token which is fine (callers must still authenticate even for unimplemented endpoints).
  `DeviceGrpcController` requires no changes — `ping` is fully public.
