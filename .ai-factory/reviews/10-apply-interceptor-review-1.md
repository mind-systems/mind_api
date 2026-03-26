# Review: Apply GrpcAuthInterceptor

**Plan:** `10-apply-interceptor.md`
**Risk Level:** 🟢 Low — all changes are mechanical boilerplate replacement

## Build Verification

`npx tsc --noEmit` passes cleanly. No compilation errors.

## Context Gates

- **ARCHITECTURE.md:** `PASS` — Modular boundaries maintained. Interceptor DI resolution verified: every module importing these controllers also imports `AuthModule`, which exports `JwtModule` and `SessionService`.
- **Import cleanup:** `PASS` — Each controller retains exactly the imports still in use:
  - `auth.grpc.controller.ts`: `RpcException`, `Metadata`, `GrpcStatus` all removed (no remaining usage) ✓
  - `breath-sessions.grpc.controller.ts`: `RpcException` + `GrpcStatus` kept (`batchGetSessions` validation), `Metadata` removed ✓
  - `users.grpc.controller.ts`: `RpcException` + `GrpcStatus` kept (`updateProfile` validation), `Metadata` removed ✓
  - `stats.grpc.controller.ts`: all three removed (no remaining usage) ✓
  - `sync.grpc.controller.ts`: all three kept (`watchChanges` stub) ✓

## Files Reviewed

| File | Verdict |
|------|---------|
| `src/grpc/decorators/grpc-token.decorator.ts` (new) | ✓ OK |
| `src/grpc/decorators/index.ts` | ✓ OK |
| `src/users/auth.grpc.controller.ts` | ✓ OK |
| `src/breath-sessions/breath-sessions.grpc.controller.ts` | ✓ OK |
| `src/users/users.grpc.controller.ts` | ✓ OK |
| `src/stats/stats.grpc.controller.ts` | ✓ OK |
| `src/sync/sync.grpc.controller.ts` | ✓ OK |

## Detailed Findings

### No critical issues found.

### Minor observations (no action required)

**1. `!` (non-null assertion) on decorated parameters**

All protected methods use `user!.sub` or `token!`. This is safe at runtime because:
- For required-auth methods: the interceptor throws `UNAUTHENTICATED` before the method body executes, so the decorated value is always populated.
- For optional-auth methods: the code uses `user?.sub ?? null` instead — no `!`.

The `?` in the parameter type (e.g., `user?: JwtPayload`) is required for ts-proto interface conformance (the second parameter is optional in the generated interface). The `!` is the correct bridge between the TypeScript type system and the runtime guarantee.

**2. `watchChanges` auth behavior change is intentional**

With the class-level interceptor on `SyncGrpcController`, unauthenticated calls to `watchChanges` will now receive `UNAUTHENTICATED` instead of `UNIMPLEMENTED`. This is the intended behavior per the plan — requiring auth even for unimplemented endpoints is good security hygiene.

**3. `@GrpcToken()` decorator follows established pattern**

The new decorator mirrors `@GrpcCurrentUser()` exactly — same factory shape, same constants file, same barrel export. Consistent and correct.

**4. DI resolution verified**

All 5 modules that register gRPC controllers correctly import `AuthModule`, which exports `JwtModule` (→ `JwtService`) and `SessionService`. `Reflector` is globally available. NestJS will instantiate `GrpcAuthInterceptor` correctly without additional provider registration.

REVIEW_PASS
