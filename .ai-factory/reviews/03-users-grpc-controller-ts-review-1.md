# Code Review: users.grpc.controller.ts

**Plan:** `03-users-grpc-controller-ts.md`
**Risk Level:** 🔴 High

---

## Critical Issues

### 1. `jwtService.decode()` does not verify the JWT signature — authentication bypass

**File:** `src/users/users.grpc.controller.ts:46`

```typescript
const payload = this.jwtService.decode(token) as JwtPayload | null;
```

`decode()` only base64-decodes the JWT payload without verifying the signature. An attacker can craft a JWT with any `sub` value and update any user's profile.

Every other auth point in the codebase uses signature verification:
- `JwtAuthGuard` → `jwtService.verifyAsync(token)` (`src/users/guards/jwt-auth.guard.ts:39`)
- `OptionalJwtAuthGuard` → `jwtService.verifyAsync(token)` (`src/users/guards/optional-jwt-auth.guard.ts:33`)
- WebSocket middleware → `jwtService.verify(token)` (`src/realtime/middleware/ws-auth.middleware.ts:36`)

**Fix:** Replace `decode` with `verifyAsync`:

```typescript
const payload = await this.jwtService.verifyAsync(token) as JwtPayload;
```

### 2. No session validity check — revoked sessions are still accepted

**File:** `src/users/users.grpc.controller.ts:44-48`

After verifying the JWT, the HTTP flow (`JwtAuthGuard`) also calls `sessionService.isValid(token)` to reject revoked sessions. The gRPC controller skips this check entirely. A user who has logged out (session revoked) can still call `updateProfile` until the JWT naturally expires.

**Fix:** After verifying the JWT, check session validity:

```typescript
const payload = await this.jwtService.verifyAsync(token) as JwtPayload;
const isValid = await this.sessionService.isValid(token);
if (!isValid) {
  throw new RpcException({
    code: GrpcStatus.UNAUTHENTICATED,
    message: 'Session not found or revoked',
  });
}
```

This requires injecting `SessionService` into the controller. `SessionService` is already exported by `AuthModule`, which `UserModule` imports.

---

## Suggestions

### 3. Consider extracting the metadata-based auth into a helper

The token extraction + verify + session check pattern is now duplicated between `auth.grpc.controller.ts` (for `logout`, though `logout` uses the raw token differently) and `users.grpc.controller.ts`. Since milestone 1.4 will replace this with `GrpcAuthInterceptor`, extracting it into a shared helper now would:
- Reduce duplication
- Make it trivial to delete when 1.4 lands

Not blocking, since this code is explicitly temporary.

---

## Positive Notes

- Input validation for `name` and `language` is correctly implemented — addresses the plan review's critical finding.
- `toProtoUserRole` and `toProtoUserDto` extraction to `grpc-mappers.ts` is clean and both controllers use the shared mapper.
- `auth.grpc.controller.ts` refactor to use `toProtoUserDto` is correct — `toProtoAuthResponse` now delegates instead of inlining.
- `UserDto` is correctly imported from `proto/generated/auth`, not from `users.ts`.
- Module registration is correct — `JwtService` is available via `AuthModule`'s exported `JwtModule`.
- Partial update construction (only including defined fields) is correct and matches the HTTP controller's behavior.
