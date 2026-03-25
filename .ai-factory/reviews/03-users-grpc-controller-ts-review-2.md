# Code Review: users.grpc.controller.ts (Round 2)

**Plan:** `03-users-grpc-controller-ts.md`
**Risk Level:** 🟢 Low

---

## Review-1 Critical Issues — Resolution

### 1. `jwtService.decode()` → `jwtService.verifyAsync()` — FIXED

`users.grpc.controller.ts:48` now uses `verifyAsync<JwtPayload>(token)`, which validates the JWT signature before returning the payload. Matches the pattern used by `JwtAuthGuard` and `OptionalJwtAuthGuard`.

### 2. Session validity check added — FIXED

`users.grpc.controller.ts:57-63` now calls `sessionService.isValid(token)` after JWT verification and rejects revoked sessions with `UNAUTHENTICATED`. `SessionService` is correctly injected and available via `AuthModule`'s exports.

---

## Verification Checklist

**Dependency injection:**
- `UserService` — provided by `UserModule` directly ✅
- `JwtService` — available via `AuthModule` → exports `JwtModule` ✅
- `SessionService` — available via `AuthModule` → exports `SessionService` ✅

**Type correctness:**
- `updateDto: { name?: string; language?: string }` is structurally compatible with `UpdateUserDto` parameter of `userService.updateProfile()` ✅
- `toProtoUserDto(result)` — `result` is `UserResponseDto`, matches function signature ✅
- Return type `Promise<UserDto>` satisfies `UserServiceController` interface ✅

**Exception flow:**
- Auth/validation errors → `RpcException` (gRPC-native) ✅
- `UserService.updateProfile` throws `NotFoundException` (HttpException) → caught by `GrpcExceptionFilter` → converted to gRPC `NOT_FOUND` ✅

**Input validation:**
- `name` length checked against `< 1` (matches `@MinLength(1)` on `UpdateUserDto`) ✅
- `language` checked against `SUPPORTED_LOCALES` (matches `@IsIn(SUPPORTED_LOCALES)` on `UpdateUserDto`) ✅
- Only defined fields are included in `updateDto` (matches `@IsOptional()` behavior) ✅

**grpc-mappers.ts extraction:**
- `toProtoUserRole` moved from `auth.grpc.controller.ts` — logic identical ✅
- `toProtoUserDto` builds same field mapping previously inlined in `toProtoAuthResponse` ✅
- `auth.grpc.controller.ts` updated to use shared mapper, `UserRole` import removed (no longer needed) ✅
- `UserDto` imported from `proto/generated/auth` (correct — `users.ts` imports but doesn't re-export) ✅

**No issues found.**

REVIEW_PASS
