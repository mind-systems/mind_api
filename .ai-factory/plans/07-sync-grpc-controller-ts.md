# Plan: sync.grpc.controller.ts

## Context
Implement the unary gRPC controller for the Sync service (`GetChanges`), injecting `SyncService` and following the established gRPC controller pattern. `WatchChanges` (server-streaming) is out of scope — it belongs to Phase 3.3 of the roadmap.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Controller implementation

- [x] **Task 1: Create `src/sync/sync.grpc.controller.ts`**
  Files: `src/sync/sync.grpc.controller.ts`
  Create `SyncGrpcController` following the exact pattern from `stats.grpc.controller.ts`:
  - Decorators: `@Controller()`, `@SyncServiceControllerMethods()`, `@UseFilters(GrpcExceptionFilter)`.
  - Implement `SyncServiceController` interface from `proto/generated/sync`.
  - Inject `SyncService`, `JwtService`, `SessionService` via constructor.
  - Include commented-out TODO lines for `GrpcAuthInterceptor` and `@GrpcCurrentUser()` (milestone 1.4), matching the style used in other gRPC controllers.
  - **`getChanges` method:** accept `(request: GetChangesRequest, metadata?: Metadata)`. Extract and verify JWT from metadata using the inline pattern (read `authorization` header → strip `Bearer ` → `jwtService.verifyAsync<JwtPayload>` → `sessionService.isValid()`). Throw `RpcException` with `GrpcStatus.UNAUTHENTICATED` on failure. Call `this.syncService.getChanges(userId, request.after, request.limit)`. Map the result to `GetChangesResponse`: if the result has `fullResync`, return `{ fullResync: true }`; otherwise return `{ payload: { events, cursor, hasMore } }` where each event's `createdAt: Date` is converted via `.toISOString()`. Use `?? undefined` for any nullable fields.
  - **`watchChanges` method:** add a stub that throws `RpcException` with `GrpcStatus.UNIMPLEMENTED` and message `'WatchChanges not implemented yet (Phase 3.3)'`. The interface requires this method to exist — the stub satisfies the type contract until streaming is built in Phase 3.3. Return type: `Observable<ChangeEvent>` — use `throwError(() => new RpcException(...))` from `rxjs`.

### Phase 2: Module registration

- [x] **Task 2: Register `SyncGrpcController` in `SyncModule`** (depends on Task 1)
  Files: `src/sync/sync.module.ts`
  Add `SyncGrpcController` to the `controllers` array alongside the existing `SyncController`. Import `JwtService` and `SessionService` dependencies: add `AuthModule` (already imported) and `JwtModule` (import `@nestjs/jwt` `JwtModule` if not already available through `AuthModule` — check how `StatsModule` resolves `JwtService`). Follow the same import pattern used by `src/stats/stats.module.ts`.
