## Code Review Summary

**Files Reviewed:** 4 (`src/grpc/grpc-mappers.ts`, `src/users/users.grpc.controller.ts`, `src/users/auth.grpc.controller.ts`, `src/users/user.module.ts`)
**Risk Level:** 🟡 Medium

### Context Gates

- **ARCHITECTURE.md** — WARN: no issues. Controller is thin, delegates to service, module boundaries respected. `UserModule` imports `AuthModule` for interceptor dependencies (`JwtService`, `SessionService`).
- **RULES.md** — ERROR: non-null assertion `user!.sub` in `users.grpc.controller.ts:52` violates the "NEVER use non-null assertion operator" rule.
- **ROADMAP.md** — no issues. Milestone 1.3 "users.grpc.controller.ts" is tracked and marked complete.

### Critical Issues

1. **`user!.sub` violates RULES.md** — `src/users/users.grpc.controller.ts:52`

   The `user` parameter is typed `JwtPayload | undefined` (via `@GrpcCurrentUser() user?: JwtPayload`), and the code uses `user!.sub` to access the user ID. RULES.md explicitly forbids the non-null assertion operator (`!`).

   Every other controller that uses `@GrpcCurrentUser()` has an explicit guard — see `auth.grpc.controller.ts` lines 94, 117, 139. This controller skips it.

   Even though `GrpcAuthInterceptor` is applied at the class level and guarantees `user` is set for authenticated requests, the rule exists precisely to prevent silent failures if the interceptor is ever removed or bypassed.

   **Fix:**
   ```typescript
   // Before validation checks, add:
   if (!user) {
     throw new RpcException({
       code: GrpcStatus.UNAUTHENTICATED,
       message: 'Authentication required',
     });
   }

   // Then change line 52 from:
   const result = await this.userService.updateProfile(user!.sub, updateDto);
   // to:
   const result = await this.userService.updateProfile(user.sub, updateDto);
   ```

### Positive Notes

- Shared mapper extraction (`grpc-mappers.ts`) is clean — `toProtoUserRole` and `toProtoUserDto` are reused across both controllers without duplication.
- Input validation correctly handles proto3 optional semantics (`!== undefined` checks) and matches the `UpdateUserDto` class-validator constraints.
- The `SUPPORTED_LOCALES` type cast `(SUPPORTED_LOCALES as readonly string[]).includes(...)` is the correct approach for checking a `readonly` tuple against a `string`.
- Class-level `@UseInterceptors(GrpcAuthInterceptor)` is appropriate here since all methods on this controller require authentication (unlike `AuthGrpcController` where only some methods need it).
- `GrpcExceptionFilter` correctly catches the `NotFoundException` thrown by `UserService.updateProfile` and maps HTTP 404 to `GrpcStatus.NOT_FOUND`.
