# Patch: 10-apply-interceptor — Review 1

Fixes all suggestions from `reviews/10-apply-interceptor-review-1.md`.

Core idea: the `GrpcAuthInterceptor` guarantees that protected methods never execute without a validated user/token. Remove every dead `if (!user)` / `if (!token)` block, tighten parameter types from optional to required, and drop imports that become unused.

---

## File 1: `src/users/auth.grpc.controller.ts`

### 1a. Remove unused imports `RpcException` and `GrpcStatus`

After removing the dead auth blocks, nothing in this controller uses `RpcException` or `GrpcStatus`.

```diff
 import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
-import { RpcException } from '@nestjs/microservices';
-import { status as GrpcStatus } from '@grpc/grpc-js';
 import {
```

### 1b. `logout` — remove dead `if (!token)` block, make `token` required

```diff
   @UseInterceptors(GrpcAuthInterceptor)
   async logout(
     _request: LogoutRequest,
-    @GrpcToken() token?: string,
+    @GrpcToken() token: string,
   ): Promise<LogoutResponse> {
-    if (!token) {
-      throw new RpcException({
-        code: GrpcStatus.UNAUTHENTICATED,
-        message: 'Missing authorization token',
-      });
-    }
     await this.sessionService.revoke(token);
```

### 1c. `createToken` — remove dead `if (!user)` block, make `user` required

```diff
   @UseInterceptors(GrpcAuthInterceptor)
   async createToken(
     request: CreateTokenRequest,
-    @GrpcCurrentUser() user?: JwtPayload,
+    @GrpcCurrentUser() user: JwtPayload,
   ): Promise<CreateTokenResponse> {
-    if (!user) {
-      throw new RpcException({
-        code: GrpcStatus.UNAUTHENTICATED,
-        message: 'Authentication required',
-      });
-    }
     const result = await this.personalAccessTokenService.create(
```

### 1d. `listTokens` — remove dead `if (!user)` block, make `user` required

```diff
   @UseInterceptors(GrpcAuthInterceptor)
   async listTokens(
     _request: ListTokensRequest,
-    @GrpcCurrentUser() user?: JwtPayload,
+    @GrpcCurrentUser() user: JwtPayload,
   ): Promise<ListTokensResponse> {
-    if (!user) {
-      throw new RpcException({
-        code: GrpcStatus.UNAUTHENTICATED,
-        message: 'Authentication required',
-      });
-    }
     const tokens = await this.personalAccessTokenService.list(user.sub);
```

### 1e. `deleteToken` — remove dead `if (!user)` block, make `user` required

```diff
   @UseInterceptors(GrpcAuthInterceptor)
   async deleteToken(
     request: DeleteTokenRequest,
-    @GrpcCurrentUser() user?: JwtPayload,
+    @GrpcCurrentUser() user: JwtPayload,
   ): Promise<DeleteTokenResponse> {
-    if (!user) {
-      throw new RpcException({
-        code: GrpcStatus.UNAUTHENTICATED,
-        message: 'Authentication required',
-      });
-    }
     await this.personalAccessTokenService.revoke(request.id, user.sub);
```

---

## File 2: `src/breath-sessions/breath-sessions.grpc.controller.ts`

No import changes — `RpcException` and `GrpcStatus` are still used by `batchGetSessions` (INVALID_ARGUMENT validation).

### 2a. `createSession` — remove dead `if (!user)` block, make `user` required

```diff
   async createSession(
     request: CreateSessionRequest,
-    @GrpcCurrentUser() user?: JwtPayload,
+    @GrpcCurrentUser() user: JwtPayload,
   ): Promise<BreathSessionDto> {
-    if (!user) {
-      throw new RpcException({
-        code: GrpcStatus.UNAUTHENTICATED,
-        message: 'Authentication required',
-      });
-    }
     const session = await this.breathSessionsService.create(user.sub, {
```

### 2b. `getSuggestions` — remove dead `if (!user)` block, make `user` required

```diff
   async getSuggestions(
     request: GetSuggestionsRequest,
-    @GrpcCurrentUser() user?: JwtPayload,
+    @GrpcCurrentUser() user: JwtPayload,
   ): Promise<GetSuggestionsResponse> {
-    if (!user) {
-      throw new RpcException({
-        code: GrpcStatus.UNAUTHENTICATED,
-        message: 'Authentication required',
-      });
-    }
     const timeOfDay = fromProtoTimeOfDay(request.timeOfDay);
```

### 2c. `updateSession` — remove dead `if (!user)` block, make `user` required

```diff
   async updateSession(
     request: UpdateSessionRequest,
-    @GrpcCurrentUser() user?: JwtPayload,
+    @GrpcCurrentUser() user: JwtPayload,
   ): Promise<BreathSessionDto> {
-    if (!user) {
-      throw new RpcException({
-        code: GrpcStatus.UNAUTHENTICATED,
-        message: 'Authentication required',
-      });
-    }
     const dto: {
```

### 2d. `replaceSession` — remove dead `if (!user)` block, make `user` required

```diff
   async replaceSession(
     request: ReplaceSessionRequest,
-    @GrpcCurrentUser() user?: JwtPayload,
+    @GrpcCurrentUser() user: JwtPayload,
   ): Promise<BreathSessionDto> {
-    if (!user) {
-      throw new RpcException({
-        code: GrpcStatus.UNAUTHENTICATED,
-        message: 'Authentication required',
-      });
-    }
     const session = await this.breathSessionsService.replace(
```

### 2e. `updateSessionSettings` — remove dead `if (!user)` block, make `user` required

```diff
   async updateSessionSettings(
     request: UpdateSessionSettingsRequest,
-    @GrpcCurrentUser() user?: JwtPayload,
+    @GrpcCurrentUser() user: JwtPayload,
   ): Promise<UpdateSessionSettingsResponse> {
-    if (!user) {
-      throw new RpcException({
-        code: GrpcStatus.UNAUTHENTICATED,
-        message: 'Authentication required',
-      });
-    }
     await this.breathSessionsService.findOne(request.id);
```

### 2f. `deleteSession` — remove dead `if (!user)` block, make `user` required

```diff
   async deleteSession(
     request: DeleteSessionRequest,
-    @GrpcCurrentUser() user?: JwtPayload,
+    @GrpcCurrentUser() user: JwtPayload,
   ): Promise<DeleteSessionResponse> {
-    if (!user) {
-      throw new RpcException({
-        code: GrpcStatus.UNAUTHENTICATED,
-        message: 'Authentication required',
-      });
-    }
     await this.breathSessionsService.remove(request.id, user.sub);
```

### 2g. No changes to optional-auth methods

`listSessions`, `batchGetSessions`, `getSession` keep `@GrpcOptionalAuth()` and `user?: JwtPayload | null`. No changes needed.

---

## File 3: `src/users/users.grpc.controller.ts`

No import changes — `RpcException` and `GrpcStatus` are still used for INVALID_ARGUMENT validation in `updateProfile`.

### 3a. `updateProfile` — remove dead `if (!user)` block, make `user` required

```diff
   async updateProfile(
     request: UpdateProfileRequest,
-    @GrpcCurrentUser() user?: JwtPayload,
+    @GrpcCurrentUser() user: JwtPayload,
   ): Promise<UserDto> {
-    if (!user) {
-      throw new RpcException({
-        code: GrpcStatus.UNAUTHENTICATED,
-        message: 'Authentication required',
-      });
-    }
-
     if (request.name !== undefined && request.name.length < 1) {
```

---

## File 4: `src/stats/stats.grpc.controller.ts`

### 4a. Remove unused imports `RpcException` and `GrpcStatus`

After removing the dead auth block, nothing in this controller uses `RpcException` or `GrpcStatus`.

```diff
 import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
-import { RpcException } from '@nestjs/microservices';
-import { status as GrpcStatus } from '@grpc/grpc-js';
 import {
```

### 4b. `getStats` — remove dead `if (!user)` block, make `user` required

```diff
   async getStats(
     _request: GetStatsRequest,
-    @GrpcCurrentUser() user?: JwtPayload,
+    @GrpcCurrentUser() user: JwtPayload,
   ): Promise<GetStatsResponse> {
-    if (!user) {
-      throw new RpcException({
-        code: GrpcStatus.UNAUTHENTICATED,
-        message: 'Authentication required',
-      });
-    }
-
     const result = await this.statsService.getStats(user.sub);
```

---

## File 5: `src/sync/sync.grpc.controller.ts`

### 5a. Remove unused imports `RpcException` and `GrpcStatus`

After removing the dead auth block, nothing uses `RpcException` or `GrpcStatus`. `GrpcMethod` is still needed.

```diff
-import { GrpcMethod, RpcException } from '@nestjs/microservices';
-import { status as GrpcStatus } from '@grpc/grpc-js';
+import { GrpcMethod } from '@nestjs/microservices';
```

### 5b. `getChanges` — remove dead `if (!user)` block, fix type from `JwtPayload | null` to `JwtPayload`

```diff
   @GrpcMethod('SyncService', 'getChanges')
   async getChanges(
     request: GetChangesRequest,
-    @GrpcCurrentUser() user: JwtPayload | null,
+    @GrpcCurrentUser() user: JwtPayload,
   ): Promise<GetChangesResponse> {
-    if (!user) {
-      throw new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' });
-    }
-
     const result = await this.syncService.getChanges(user.sub, request.after, request.limit);
```
