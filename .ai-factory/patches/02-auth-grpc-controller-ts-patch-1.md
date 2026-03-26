# Patch: 02-auth-grpc-controller-ts-patch-1

Fixes issues from review `02-auth-grpc-controller-ts-review-1.md`.

---

## Fix 1 — Remove non-null assertions from `auth.grpc.controller.ts`

**File:** `src/users/auth.grpc.controller.ts`
**Problem:** 4 uses of the `!` operator (lines 77, 87, 103, 119) violate `RULES.md` ("NEVER use non-null assertion operator"). The interceptor guarantees these values are populated, but the rule requires explicit checks that fail loudly.
**Approach:** Add a new import for `RpcException` and `status as GrpcStatus`. Add explicit guard clauses before each use of `token` and `user`, throwing `UNAUTHENTICATED` RpcException on the impossible-but-checked path.

### 1a. Add imports

Add `RpcException` and gRPC status to imports.

```diff
 import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
+import { RpcException } from '@nestjs/microservices';
+import { status as GrpcStatus } from '@grpc/grpc-js';
 import {
```

### 1b. Fix `logout` — replace `token!` with explicit check

Replace:
```typescript
  @UseInterceptors(GrpcAuthInterceptor)
  async logout(
    _request: LogoutRequest,
    @GrpcToken() token?: string,
  ): Promise<LogoutResponse> {
    await this.sessionService.revoke(token!);
    return { message: 'Logout successful.' };
  }
```

With:
```typescript
  @UseInterceptors(GrpcAuthInterceptor)
  async logout(
    _request: LogoutRequest,
    @GrpcToken() token?: string,
  ): Promise<LogoutResponse> {
    if (!token) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing authorization token',
      });
    }
    await this.sessionService.revoke(token);
    return { message: 'Logout successful.' };
  }
```

### 1c. Fix `createToken` — replace `user!.sub` with explicit check

Replace:
```typescript
  @UseInterceptors(GrpcAuthInterceptor)
  async createToken(
    request: CreateTokenRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<CreateTokenResponse> {
    const result = await this.personalAccessTokenService.create(
      user!.sub,
      request.name,
    );
```

With:
```typescript
  @UseInterceptors(GrpcAuthInterceptor)
  async createToken(
    request: CreateTokenRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<CreateTokenResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const result = await this.personalAccessTokenService.create(
      user.sub,
      request.name,
    );
```

### 1d. Fix `listTokens` — replace `user!.sub` with explicit check

Replace:
```typescript
  @UseInterceptors(GrpcAuthInterceptor)
  async listTokens(
    _request: ListTokensRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<ListTokensResponse> {
    const tokens = await this.personalAccessTokenService.list(user!.sub);
```

With:
```typescript
  @UseInterceptors(GrpcAuthInterceptor)
  async listTokens(
    _request: ListTokensRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<ListTokensResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const tokens = await this.personalAccessTokenService.list(user.sub);
```

### 1e. Fix `deleteToken` — replace `user!.sub` with explicit check

Replace:
```typescript
  @UseInterceptors(GrpcAuthInterceptor)
  async deleteToken(
    request: DeleteTokenRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<DeleteTokenResponse> {
    await this.personalAccessTokenService.revoke(request.id, user!.sub);
```

With:
```typescript
  @UseInterceptors(GrpcAuthInterceptor)
  async deleteToken(
    request: DeleteTokenRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<DeleteTokenResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    await this.personalAccessTokenService.revoke(request.id, user.sub);
```

---

## Fix 2 — Handle `string[]` message in `grpc-exception.filter.ts`

**File:** `src/grpc/grpc-exception.filter.ts`
**Problem:** `HttpException.getResponse()` can return `{ message: string[] }` (e.g. class-validator validation errors). The array is passed directly to `RpcException`, but gRPC status messages are strings. An array will stringify unpredictably.
**Approach:** Extract the raw message first, then normalize: if it's an array, join with `'; '`.

Replace:
```typescript
    const message =
      typeof response === 'string'
        ? response
        : ((response as { message?: string | string[] }).message ??
          exception.message);
```

With:
```typescript
    const raw =
      typeof response === 'string'
        ? response
        : ((response as { message?: string | string[] }).message ??
          exception.message);

    const message = Array.isArray(raw) ? raw.join('; ') : raw;
```
