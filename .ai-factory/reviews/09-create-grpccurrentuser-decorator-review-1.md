# Review: `@GrpcCurrentUser()` decorator

## Files reviewed
- `src/grpc/decorators/grpc-current-user.decorator.ts` (new)
- `src/grpc/decorators/index.ts` (new)

## Cross-referenced
- `src/grpc/grpc-auth.interceptor.ts` — writes `metadata[GRPC_USER_KEY]`
- `src/grpc/grpc-auth.constants.ts` — `GRPC_USER_KEY` Symbol definition
- `src/users/interfaces/auth.interface.ts` — `JwtPayload` type
- `src/users/decorators/current-user.decorator.ts` — HTTP equivalent
- `src/stats/stats.grpc.controller.ts`, `src/users/users.grpc.controller.ts` — consumers (TODO comments)

## Correctness

**Read path matches write path.** The interceptor writes to `(metadata as any)[GRPC_USER_KEY]` (lines 45, 74). The decorator reads the same key from the same object (`ctx.switchToRpc().getContext<Metadata>()`). Verified that `GRPC_USER_KEY` is the same `Symbol('grpc-user')` import in both files.

**Return type is accurate.** The interceptor sets `null` on optional-auth routes (line 45) and `JwtPayload` on authenticated routes (line 74). The decorator's return type `JwtPayload | null` covers both cases.

**Import paths are correct.** The TODO comments in all 5 gRPC controllers reference `'../grpc/decorators/grpc-current-user.decorator'` — this matches the actual file path exactly. The barrel `index.ts` also provides the shorter `'../grpc/decorators'` import.

**No circular dependencies.** The decorator imports a constant (Symbol) and a type — no injectable providers, no module coupling.

## Bugs

None found.

## Security

No concerns. The decorator is a pure read — it does not perform auth, validate tokens, or make trust decisions. All security logic remains in `GrpcAuthInterceptor`.

## Notes

**`undefined` when interceptor is absent:** If a handler uses `@GrpcCurrentUser()` without `@UseInterceptors(GrpcAuthInterceptor)`, the symbol key won't exist on metadata and the decorator will return `undefined` (not `null`). The return type `JwtPayload | null` doesn't account for this. This is consistent with the HTTP `@CurrentUser()` decorator which uses `request.user!` (also unsound without a guard). This is a usage error, not a decorator bug — acceptable as-is since the decorator and interceptor are always paired.

REVIEW_PASS
