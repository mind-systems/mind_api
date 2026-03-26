# Plan: Create `sync-stream.grpc.controller.ts` (replay phase)

## Context
Implement the `WatchChanges` server-streaming gRPC RPC in a new controller under `src/realtime/`. The controller replays change events since the client's cursor by looping `ChangeLogService.getChanges()` until `hasMore = false`, then leaves the stream open for the live push phase (next milestone). When `afterId` is omitted the replay phase is skipped and the stream opens at the current position (live-only mode), matching the proto contract.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Split `watchChanges` out of `SyncGrpcController`

- [x] **Task 1: Remove `watchChanges` stub from `SyncGrpcController`**
  Files: `src/sync/sync.grpc.controller.ts`
  Remove the `watchChanges` method (the `UNIMPLEMENTED` stub) entirely. Replace `@SyncServiceControllerMethods()` class decorator with an explicit `@GrpcMethod('SyncService', 'getChanges')` decorator on the `getChanges` method — this is needed because `SyncServiceControllerMethods()` auto-registers both `getChanges` and `watchChanges`, but `watchChanges` is moving to a different controller. Remove `implements SyncServiceController` from the class declaration (partial interface adherence isn't valid). Remove all now-unused imports:
  - `Observable`, `throwError` from `rxjs`
  - `WatchChangesRequest`, `ChangeEvent`, `SyncServiceControllerMethods` from proto generated
  - `Metadata`, `status as GrpcStatus` from `@grpc/grpc-js`
  - `RpcException` from `@nestjs/microservices`

  After cleanup, `@nestjs/microservices` should import only `GrpcMethod` (add it). The remaining proto imports are `GetChangesRequest` and `GetChangesResponse`. Verify no unused imports remain — ESLint `no-unused-vars` will fail the build otherwise.

### Phase 2: Implement the replay-phase controller

- [x] **Task 2: Create `src/realtime/sync-stream.grpc.controller.ts`**
  Files: `src/realtime/sync-stream.grpc.controller.ts`
  Create a new controller `SyncStreamGrpcController` that owns the `WatchChanges` server-streaming RPC. Follow the existing gRPC controller pattern:
  - Class decorators: `@Controller()`, `@UseFilters(GrpcExceptionFilter)`, `@UseInterceptors(GrpcAuthInterceptor)`.
  - Method decorator: `@GrpcMethod('SyncService', 'watchChanges')` on the `watchChanges` method.
  - Inject `ChangeLogService` (it's `@Global()`, no module import needed).
  - Method signature: `watchChanges(request: WatchChangesRequest, metadata?: Metadata): Observable<ChangeEvent>` — matching the generated proto interface.

  **Auth — explicit null guard (RULES.md compliance):**
  The `@GrpcCurrentUser()` decorator returns `JwtPayload | null`. Type the parameter as `user: JwtPayload | null` and add an explicit null guard before using `user.sub`:
  ```typescript
  if (!user) {
    subscriber.error(
      new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' }),
    );
    return;
  }
  ```
  Do NOT use `user!.sub` or type the parameter as non-nullable `JwtPayload` — both violate the "NEVER use non-null assertion" rule.

  **Replay logic** (inside the Observable constructor):
  1. Determine whether replay is needed: check if `request.afterId` is defined (`request.afterId !== undefined`). If `afterId` is undefined, skip steps 2-3 entirely — the proto contract says *"when after_id is omitted the server streams only new events from the connection moment"*. The stream opens at the current position (live-only mode). If `afterId` is defined, set `cursor = request.afterId` and proceed with replay.
  2. **Full-resync guard:** call `changeLogService.getMinEventId()`. The method returns `number | null` (null when the table is empty). Apply the guard only when `minEventId` is not null: if `minEventId !== null && cursor !== 0 && cursor < minEventId`, emit an `RpcException` with `FAILED_PRECONDITION` status and message `"cursor too old, full resync required"` via `subscriber.error()` and return. This mirrors the guard in `SyncService.getChanges()` (line 35) — note the triple condition including the null check.
  3. **Replay loop:** call `changeLogService.getChanges(userId, cursor, 100)` in a `while` loop. For each batch, emit a `ChangeEvent` message via `subscriber.next()`. The proto `ChangeEvent` wraps an `events` array of `SyncEventDto`, so each emission maps the batch: `{ events: result.events.map(e => ({ id: e.id, entity: e.entity, refId: e.refId, action: e.action, createdAt: e.createdAt.toISOString() })) }`. Advance `cursor` to `result.cursor`. Break when `result.hasMore` is `false`.
  4. After replay completes (or when replay was skipped), do NOT call `subscriber.complete()` — the Subject stays open so the live push phase (next milestone) can continue writing events to it.
  5. **Teardown:** add a teardown callback via `subscriber.add(() => { ... })` that will be called when the client cancels the stream. For now this is a no-op placeholder (the live phase milestone will register/unregister from `streamMap` here).

  Wrap the entire async replay in a `.catch()` that calls `subscriber.error(err)` to surface unexpected errors as gRPC `INTERNAL` errors.

  **Import note:** The controller imports `ChangeEvent` and `SyncEventDto` from `../../proto/generated/sync` (proto message types). `ChangeLogService.getChanges()` returns `ChangesResult` whose `events` are `ChangeEvent` entities from `src/changelog/entities/change-event.entity.ts` — a different type with the same name. Since only `ChangeLogService` is injected (not the entity), there is no direct import collision, but avoid importing the entity type to prevent confusion. If a type annotation is needed for the result, use the `ChangesResult` interface from `src/changelog/changelog.service.ts`.

- [x] **Task 3: Register `SyncStreamGrpcController` in `RealtimeModule`**
  Files: `src/realtime/realtime.module.ts`
  Add `SyncStreamGrpcController` to the `controllers` array (create the array if not present — currently `RealtimeModule` has no `controllers` key). Import the controller from `./sync-stream.grpc.controller`.
