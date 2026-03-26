# Plan: Create `src/grpc/grpc-auth.interceptor.ts`

## Context
Create a NestJS interceptor that authenticates gRPC calls by reading JWT from metadata, verifying the signature, validating the session against the database, and making both the user payload and raw token available to downstream handlers. This replaces the inline `extractUser` / `extractOptionalUser` logic currently duplicated across all gRPC controllers. The interceptor also supports optional-auth routes (where unauthenticated callers are allowed) via a `@GrpcOptionalAuth()` reflector decorator.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Shared constants and decorators

- [x] **Task 1: Create shared gRPC auth constants**
  Files: `src/grpc/grpc-auth.constants.ts`
  Create a file exporting two Symbol keys and one Reflector metadata key:
  - `GRPC_USER_KEY = Symbol('grpc-user')` — storage key for the authenticated `JwtPayload` on the gRPC metadata object.
  - `GRPC_TOKEN_KEY = Symbol('grpc-token')` — storage key for the raw JWT string on the gRPC metadata object. Needed by handlers like `logout()` that call `sessionService.revoke(token)` with the original token.
  - `GRPC_OPTIONAL_AUTH_KEY = 'grpc-optional-auth'` — a string key used with `@SetMetadata` / `Reflector` to mark routes where authentication is optional (e.g. `listSessions`, `getSession`, `batchGetSessions`).

  All three are imported by the interceptor (Task 3), the `@GrpcCurrentUser()` decorator (future milestone task), and the `@GrpcOptionalAuth()` decorator (Task 2).

- [x] **Task 2: Create `@GrpcOptionalAuth()` decorator** (depends on Task 1)
  Files: `src/grpc/decorators/grpc-optional-auth.decorator.ts`
  Create a simple NestJS decorator using `SetMetadata`:
  ```typescript
  export const GrpcOptionalAuth = () => SetMetadata(GRPC_OPTIONAL_AUTH_KEY, true);
  ```
  Import `SetMetadata` from `@nestjs/common` and `GRPC_OPTIONAL_AUTH_KEY` from `../grpc-auth.constants`. This decorator will be applied to handler methods where unauthenticated callers should be allowed through (the interceptor stores `null` for user/token instead of throwing).

### Phase 2: Interceptor implementation

- [x] **Task 3: Create `GrpcAuthInterceptor`** (depends on Tasks 1-2)
  Files: `src/grpc/grpc-auth.interceptor.ts`
  Create an `@Injectable()` class implementing `NestInterceptor`. Inject three dependencies:
  - `JwtService` (from `@nestjs/jwt`)
  - `SessionService` (from `src/users/service/session.service.ts`)
  - `Reflector` (from `@nestjs/core`)

  Both `JwtService` and `SessionService` are already exported by `AuthModule` (lines 52-60 of `auth.module.ts`). Any module that registers this interceptor must import `AuthModule` to satisfy DI — this is already the case for all existing gRPC controllers (`BreathSessionsModule` imports `AuthModule`, and `AuthModule` itself provides both services).

  `intercept(context: ExecutionContext, next: CallHandler)` logic:

  1. **Check optional-auth flag** — use `this.reflector.get<boolean>(GRPC_OPTIONAL_AUTH_KEY, context.getHandler())` to determine if the current route allows unauthenticated access.
  2. **Get metadata** — call `context.switchToRpc().getContext()`. In NestJS gRPC transport this returns the `Metadata` object from `@grpc/grpc-js`. Type it as `Metadata`.
  3. **Extract token** — read `metadata.get('authorization')`, take the first element, call `.toString()`. If it starts with `'Bearer '`, strip the prefix. Match the exact extraction pattern used in `BreathSessionsGrpcController.extractUser()` (lines 54-55 of `breath-sessions.grpc.controller.ts`).
  4. **Missing token** — if no token after extraction:
     - If `isOptionalAuth` is `true`: store `null` under both `GRPC_USER_KEY` and `GRPC_TOKEN_KEY` on metadata, then return `next.handle()` (skip verification, let handler run with no user).
     - Otherwise: throw `new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing authorization metadata' })`.
  5. **Verify JWT** — call `this.jwtService.verifyAsync<JwtPayload>(token)` in a try/catch. On failure throw `new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Invalid authorization token' })`. This applies even for optional-auth routes — if a token is provided but invalid, that's always an error.
  6. **Validate session** — call `this.sessionService.isValid(token)`. If `false`, throw `new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Session not found or revoked' })`. Same as above — provided but revoked tokens are rejected even on optional-auth routes.
  7. **Store user and token** — set both values on the metadata object using Symbol keys:
     - `(metadata as any)[GRPC_USER_KEY] = payload`
     - `(metadata as any)[GRPC_TOKEN_KEY] = token`
     Using Symbol keys avoids collisions with gRPC string metadata keys and makes the properties invisible to normal `Metadata` iteration. `Metadata` from `@grpc/grpc-js` is a plain JS object — not frozen or sealed — so adding Symbol properties is safe. Add a comment in the implementation: `// Symbol keys: invisible to Metadata iteration, won't collide with string keys`.
  8. **Continue** — return `next.handle()`.

  Error messages must exactly match the three strings from the existing inline pattern (`'Missing authorization metadata'`, `'Invalid authorization token'`, `'Session not found or revoked'`) to maintain consistent error responses.

  Do NOT handle PAT tokens (`pat_` prefix) — the existing gRPC controller inline auth does not support PATs, and PAT support for gRPC is not in scope.

  Import `JwtPayload` type from `src/users/interfaces/auth.interface.ts`.

- [x] **Task 4: Re-export interceptor, decorator, and constants from barrel**
  Files: `src/grpc/index.ts`
  Create a barrel file re-exporting the public API of the `src/grpc/` directory:
  - `export { GrpcAuthInterceptor } from './grpc-auth.interceptor'`
  - `export { GrpcOptionalAuth } from './decorators/grpc-optional-auth.decorator'`
  - `export { GRPC_USER_KEY, GRPC_TOKEN_KEY, GRPC_OPTIONAL_AUTH_KEY } from './grpc-auth.constants'`
  - `export { GrpcExceptionFilter } from './grpc-exception.filter'`

  Check whether existing imports of `GrpcExceptionFilter` and mapper functions already use direct paths. If all existing imports use direct paths (e.g. `'../grpc/grpc-exception.filter'`), skip creating the barrel to stay consistent — do not introduce a new import convention mid-project.
