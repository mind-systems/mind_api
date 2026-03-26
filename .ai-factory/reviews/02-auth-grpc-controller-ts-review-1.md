## Code Review Summary

**Files Reviewed:** 3
**Risk Level:** 🟡 Medium

### Context Gates

- **ARCHITECTURE.md** — WARN: no violations. Controller is thin, delegates to services, respects module boundaries. All injected services are registered providers within `AuthModule`.
- **RULES.md** — ERROR: 4 uses of non-null assertion operator (`!`) in `auth.grpc.controller.ts`. Rule says "NEVER use non-null assertion operator".
- **ROADMAP.md** — WARN: milestone `auth.grpc.controller.ts` is checked off in 1.3. No linkage issues.

### Critical Issues

**1. RULES.md violation: non-null assertion operator (`!`) used 4 times**

`src/users/auth.grpc.controller.ts` lines 77, 87, 103, 119:

```typescript
// Line 77
await this.sessionService.revoke(token!);

// Line 87
user!.sub,

// Line 103
const tokens = await this.personalAccessTokenService.list(user!.sub);

// Line 119
await this.personalAccessTokenService.revoke(request.id, user!.sub);
```

The `GrpcAuthInterceptor` guarantees that `token` and `user` are populated for protected methods, but the project rule is absolute — explicit checks must replace `!`. The original implementation (before the interceptor was wired in) had proper guard clauses:

```typescript
if (!user) {
  throw new RpcException({
    code: GrpcStatus.UNAUTHENTICATED,
    message: 'Authentication required',
  });
}
```

These were stripped when `@GrpcCurrentUser()` / `@GrpcToken()` were introduced. Fix: either restore explicit checks with `RpcException`, or throw a generic internal error since the interceptor should prevent this path:

```typescript
// Option A: defensive check with clear error (preferred)
if (!token) {
  throw new RpcException({
    code: GrpcStatus.UNAUTHENTICATED,
    message: 'Missing authorization token',
  });
}
await this.sessionService.revoke(token);
```

**2. `grpc-exception.filter.ts` — `message` can be `string[]`, which won't serialize cleanly for gRPC clients**

`src/grpc/grpc-exception.filter.ts` line 37-41:

```typescript
const message =
  typeof response === 'string'
    ? response
    : ((response as { message?: string | string[] }).message ??
      exception.message);
```

`HttpException.getResponse()` returns `{ message: string[] }` for validation errors (class-validator). The array is passed directly to `RpcException({ code, message })`. gRPC status messages are strings — an array will be stringified as `"inhale,exhale,hold"` or similar, losing structure. Fix:

```typescript
const raw = (response as { message?: string | string[] }).message ?? exception.message;
const message = Array.isArray(raw) ? raw.join('; ') : raw;
```

### Positive Notes

- Clean separation: `toProtoAuthResponse` and `toProtoUserDto` (from shared `grpc-mappers.ts`) keep mapping logic out of the controller methods.
- `@GrpcToken()` decorator is a good pattern for extracting the raw token without re-parsing metadata in every controller method.
- Exception filter HTTP-to-gRPC status mapping covers all status codes used by existing services (400, 401, 403, 404, 409, 429).
- Service call signatures match exactly — all parameter types and return types align between the controller and the underlying services.
- Module registration is correct — all four injected services are already in `AuthModule.providers`.
