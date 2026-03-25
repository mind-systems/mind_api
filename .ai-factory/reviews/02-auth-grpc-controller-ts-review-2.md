# Code Review (Round 2): auth.grpc.controller.ts

**Files reviewed:** `src/grpc/grpc-exception.filter.ts`, `src/users/auth.grpc.controller.ts`, `src/users/auth.module.ts`

---

## Review-1 Issue Resolution

All 7 issues from review-1 have been addressed:

| # | Issue | Status |
|---|---|---|
| 1 | `user!.sub` non-null assertion (RULES.md violation) | Fixed — explicit `if (!user)` guard with `RpcException(UNAUTHENTICATED)` |
| 2 | `logout` silent no-op on missing token | Fixed — validates non-empty token, throws `UNAUTHENTICATED` |
| 3 | Unused `UseInterceptors` import | Fixed — removed from import |
| 4 | Unsafe enum comparison in `toProtoUserRole` | Fixed — parameter typed `UserRole` instead of `string` |
| 5 | Unused `_host` parameter ESLint error | Fixed — `eslint-disable-next-line` directive added |
| 6 | Prettier formatting | Fixed — formatted correctly |
| 7 | Duplicated DTO→proto mapping | Fixed — extracted `toProtoAuthResponse()` helper |

## Verification

- **`tsc --noEmit`**: clean, no errors
- **ESLint** on all three changed files: clean, no errors
- **Service call signatures**: all 7 verified against source — `sendCode(email, locale?)`, `verifyCode(email, code, language?)`, `signInWithGoogle(serverAuthCode, language?, redirectUri?)`, `sessionService.revoke(token)`, `personalAccessTokenService.create(userId, name)`, `.list(userId)`, `.revoke(id, userId)` — all match
- **Proto return types**: all 7 response shapes match generated `AuthServiceController` interface exactly
- **Module registration**: `AuthGrpcController` added to `controllers`; all four injected services already in `providers`
- **No migrations required**: pure controller addition

## Notes

- Protected methods (`createToken`, `listTokens`, `deleteToken`) will always return `UNAUTHENTICATED` until milestone 1.4 wires `GrpcAuthInterceptor` + `@GrpcCurrentUser()`. This is the intended behavior — safe stub per the plan's dependency section.
- `RpcException` thrown directly in the controller bypasses `GrpcExceptionFilter` (which catches `HttpException` only) and is handled correctly by NestJS's built-in `BaseRpcExceptionFilter`.
- `GrpcExceptionFilter` correctly covers all `HttpException` subclasses thrown by existing services: `HttpException(429)` → `RESOURCE_EXHAUSTED`, `UnauthorizedException` → `UNAUTHENTICATED`, `NotFoundException` → `NOT_FOUND`.

REVIEW_PASS
