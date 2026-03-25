# Code Review: auth.grpc.controller.ts

**Files reviewed:** `src/grpc/grpc-exception.filter.ts`, `src/users/auth.grpc.controller.ts`, `src/users/auth.module.ts`
**Risk level:** RED — critical issues block merge

---

## Critical Issues

### 1. Non-null assertion `user!` violates RULES.md and crashes at runtime

`src/users/auth.grpc.controller.ts:111,126,143`

The `!` operator is used three times: `user!.sub`. RULES.md explicitly forbids non-null assertions. Worse, with the gRPC auth interceptor not yet wired (commented out as TODO), `user` **will be `undefined` at runtime** — every call to `createToken`, `listTokens`, or `deleteToken` will throw `TypeError: Cannot read properties of undefined (reading 'sub')`.

Fix: add explicit guard with a meaningful gRPC error:

```typescript
if (!user) {
  throw new RpcException({
    code: GrpcStatus.UNAUTHENTICATED,
    message: 'Authentication required',
  });
}
const tokens = await this.personalAccessTokenService.list(user.sub);
```

This also requires importing `RpcException` and `status as GrpcStatus`.

### 2. `logout` silently succeeds when metadata or token is missing

`src/users/auth.grpc.controller.ts:99-101`

```typescript
const raw = metadata?.get('authorization')[0]?.toString() ?? '';
const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
await this.sessionService.revoke(token);
```

If `metadata` is undefined, or has no `authorization` key, `raw` resolves to `''`. Then `sessionService.revoke('')` hashes an empty string, finds no matching session, silently returns. The client receives "Logout successful." without anything being revoked.

Fix: validate the token is non-empty before calling revoke:

```typescript
const raw = metadata?.get('authorization')[0]?.toString();
const token = raw?.startsWith('Bearer ') ? raw.slice(7) : raw;
if (!token) {
  throw new RpcException({
    code: GrpcStatus.UNAUTHENTICATED,
    message: 'Missing authorization metadata',
  });
}
await this.sessionService.revoke(token);
```

---

## Must-Fix (ESLint errors — CI will fail)

### 3. Unused import `UseInterceptors`

`src/users/auth.grpc.controller.ts:1`

`UseInterceptors` is imported but all `@UseInterceptors(...)` decorators are commented out. ESLint flags this as `@typescript-eslint/no-unused-vars` error.

Fix: remove `UseInterceptors` from the import statement. Re-add it when 1.4 is merged.

### 4. `toProtoUserRole` — unsafe enum comparison

`src/users/auth.grpc.controller.ts:33,35`

```typescript
function toProtoUserRole(role: string): number {
  switch (role) {
    case UserRole.ADMIN:  // ESLint: no-unsafe-enum-comparison
```

Parameter is typed `string` but compared against `UserRole` enum values. `UserResponseDto.role` is already typed as `UserRole`, so the fix is straightforward:

```typescript
function toProtoUserRole(role: UserRole): number {
```

### 5. Unused parameter `_host` in exception filter

`src/grpc/grpc-exception.filter.ts:27`

The ESLint config has no `argsIgnorePattern: '^_'`, so underscore-prefixed parameters are still flagged. Since the `ExceptionFilter` interface requires the `host` parameter, suppress with a directive:

```typescript
// eslint-disable-next-line @typescript-eslint/no-unused-vars
catch(exception: HttpException, _host: ArgumentsHost) {
```

### 6. Prettier formatting violations

`src/grpc/grpc-exception.filter.ts:1,34` and `src/users/auth.grpc.controller.ts:111`

Auto-fixable: run `npm run format`.

---

## Suggestions

### 7. Duplicated AuthResponseDto-to-proto mapping

`src/users/auth.grpc.controller.ts:63-72` and `src/users/auth.grpc.controller.ts:81-90`

`verifyCode` and `googleAuth` both contain identical mapping logic. Extract to a helper alongside `toProtoUserRole`:

```typescript
function toProtoAuthResponse(dto: AuthResponseDto): AuthResponse {
  return {
    accessToken: dto.accessToken,
    user: {
      id: dto.user.id,
      email: dto.user.email,
      name: dto.user.name,
      role: toProtoUserRole(dto.user.role),
      language: dto.user.language,
    },
  };
}
```

---

## Positive Notes

- Exception filter correctly maps HTTP status codes to gRPC `Status` constants with full coverage of the codes used by existing services (429, 401, 404).
- `metadata.get()[0]?.toString()` correctly handles the `Buffer` return type from gRPC metadata.
- Proto interface implementation matches all 7 RPC methods with correct return types.
- Service call signatures verified against source: `sendCode(email, locale?)`, `verifyCode(email, code, language?)`, `signInWithGoogle(serverAuthCode, language?, redirectUri?)`, `sessionService.revoke(token)`, `personalAccessTokenService.create(userId, name)`, `.list(userId)`, `.revoke(id, userId)` — all correct.
- Module registration is minimal and correct — only adds the controller, no unnecessary provider changes.
- TypeScript compilation passes (`tsc --noEmit` clean).

---

## Verdict

3 critical issues + 4 ESLint errors that block CI. Fix #1-6 before merge.
