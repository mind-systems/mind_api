# Patch: 03-users-grpc-controller-ts-patch-1

Fixes critical issue from review `03-users-grpc-controller-ts-review-1`.

## Issue 1: Non-null assertion `user!.sub` violates RULES.md

**File:** `src/users/users.grpc.controller.ts`
**Line:** 52
**Severity:** Critical (project rule violation)

**Problem:** The `user` parameter is typed `JwtPayload | undefined` but accessed via `user!.sub`, using the non-null assertion operator. RULES.md forbids `!` — all nullable values must be checked explicitly. Every other gRPC controller method that uses `@GrpcCurrentUser()` has an explicit `if (!user)` guard (see `auth.grpc.controller.ts` lines 94, 117, 139).

**Fix:** Add an explicit authentication guard at the top of the method body (before input validation), then remove the `!` from the service call.

```diff
  async updateProfile(
    request: UpdateProfileRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<UserDto> {
+   if (!user) {
+     throw new RpcException({
+       code: GrpcStatus.UNAUTHENTICATED,
+       message: 'Authentication required',
+     });
+   }
+
    if (request.name !== undefined && request.name.length < 1) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: 'name must be at least 1 character',
      });
    }

    if (
      request.language !== undefined &&
      !(SUPPORTED_LOCALES as readonly string[]).includes(request.language)
    ) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: 'language must be one of: en, ru',
      });
    }

    const updateDto: { name?: string; language?: string } = {};
    if (request.name !== undefined) updateDto.name = request.name;
    if (request.language !== undefined) updateDto.language = request.language;

-   const result = await this.userService.updateProfile(user!.sub, updateDto);
+   const result = await this.userService.updateProfile(user.sub, updateDto);
    return toProtoUserDto(result);
  }
```

No other files require changes.
