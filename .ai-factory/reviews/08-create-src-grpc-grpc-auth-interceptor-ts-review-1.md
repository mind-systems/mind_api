# Code Review: `src/grpc/grpc-auth.interceptor.ts`

**Files reviewed:** 3 new files, cross-referenced against 6 gRPC controllers, `SessionService`, `AuthModule`, `JwtPayload` interface, and the implementation plan
**TypeScript compilation:** Pass (`tsc --noEmit` — zero errors)
**Risk level:** 🟢 Low

## Plan compliance

| Task | Status | Notes |
|------|--------|-------|
| Task 1: Constants | ✅ | `GRPC_USER_KEY`, `GRPC_TOKEN_KEY`, `GRPC_OPTIONAL_AUTH_KEY` — all three exported correctly |
| Task 2: `@GrpcOptionalAuth()` decorator | ✅ | Matches plan — `SetMetadata(GRPC_OPTIONAL_AUTH_KEY, true)` |
| Task 3: `GrpcAuthInterceptor` | ✅ | All 8 steps implemented correctly (see detailed check below) |
| Task 4: Barrel file | ✅ Skipped | Correct decision — all 6 controllers import via direct paths (`'../grpc/grpc-exception.filter'`), no barrel convention exists |

## Interceptor logic — step-by-step verification

1. **Reflector check** (line 32–35): Reads `GRPC_OPTIONAL_AUTH_KEY` from handler metadata via `Reflector`. Correct — `Reflector` is globally available, no module import needed. ✅
2. **Get metadata** (line 37): `context.switchToRpc().getContext<Metadata>()`. NestJS gRPC transport always provides `Metadata` here — no optional chaining needed (contrast with controller method signatures where `metadata?: Metadata`). ✅
3. **Extract token** (lines 39–40): `metadata.get('authorization')[0]?.toString()` → strip `'Bearer '` prefix. Byte-identical to `BreathSessionsGrpcController.extractUser()` lines 54–55. ✅
4. **Missing token — required auth** (lines 49–52): Throws `UNAUTHENTICATED` / `'Missing authorization metadata'`. Matches inline pattern. ✅
5. **Missing token — optional auth** (lines 43–47): Stores `null` under both Symbol keys, continues. Matches `extractOptionalUser()` behavior (returns `null` on missing token, lines 86–88 of `breath-sessions.grpc.controller.ts`). ✅
6. **Invalid token on optional-auth route**: Still throws `UNAUTHENTICATED`. Correct — matches `extractOptionalUser()` which also throws on invalid/expired tokens (lines 92–96). ✅
7. **JWT verification** (lines 55–63): `verifyAsync<JwtPayload>(token)` in try/catch, throws `'Invalid authorization token'`. ✅
8. **Session validation** (lines 65–71): `sessionService.isValid(token)`, throws `'Session not found or revoked'`. ✅
9. **Store payload + raw token** (lines 73–75): Both `GRPC_USER_KEY` → payload and `GRPC_TOKEN_KEY` → token stored on metadata via Symbol keys. Comment present explaining why. ✅
10. **Return** (line 77): `next.handle()`. ✅

## Edge cases verified

| Scenario | Behavior | Correct? |
|----------|----------|----------|
| No `authorization` metadata key | `metadata.get()` returns `[]`, `[0]` is `undefined`, `!token` triggers missing-token path | ✅ |
| Token is empty string `''` | Falsy, triggers missing-token path | ✅ |
| Token is `'Bearer '` (no value after prefix) | `slice(7)` yields `''`, falsy, triggers missing-token path | ✅ |
| Token is `'Bearer <valid>'` | Prefix stripped, JWT verified, session checked | ✅ |
| Token without `Bearer` prefix (raw JWT) | Used as-is, matches existing inline behavior | ✅ |

## DI resolution

The interceptor injects `JwtService`, `SessionService`, and `Reflector`:
- `Reflector` — provided globally by `@nestjs/core`. ✅
- `JwtService` — exported by `AuthModule` via `JwtModule` (line 57 of `auth.module.ts`). ✅
- `SessionService` — exported by `AuthModule` (line 56 of `auth.module.ts`). ✅

When applied via `@UseInterceptors(GrpcAuthInterceptor)`, NestJS resolves dependencies from the controller's module scope. All gRPC controllers needing auth either live in `AuthModule` (`AuthGrpcController`) or in modules that import `AuthModule` (`BreathSessionsModule`, `StatsModule`, `SyncModule`). ✅

## Critical issues

None.

## Suggestions

None — the implementation is clean, correct, and matches both the plan and the existing inline auth patterns.

## Positive notes

- Error messages are byte-identical to the inline pattern across all 5 authenticated controllers — no behavior change when the interceptor replaces inline auth.
- The optional-auth branch correctly replicates the `extractOptionalUser` semantics: missing token → `null`, invalid/revoked token → throw even on optional routes.
- Storing the raw token under `GRPC_TOKEN_KEY` solves the `logout()` use case where `sessionService.revoke(token)` needs the original string.
- Using `Metadata` from `getContext()` (no optional chaining) is correct — unlike controller method params where metadata is optional, the RPC context always has a `Metadata` instance.
- The `async intercept()` return type `Promise<Observable<unknown>>` is valid per the `NestInterceptor` interface contract.

REVIEW_PASS
