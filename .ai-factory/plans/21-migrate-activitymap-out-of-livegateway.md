# Plan: Migrate `activityMap` out of `LiveGateway`

## Context
Extract `activityMap` and grace timer logic from `StateStore` / `GraceTimerManager` into a self-contained `ActivitySessionStore` service so that both `LiveGateway` and `LiveStreamGrpcController` consume session state through a single store — eliminating direct `stateStore.activityMap.has()` calls duplicated across both transport layers and making it safe to delete the WS gateway later.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Create the store

- [x] **Task 1: Create `ActivitySessionStore` service**
  Files: `src/realtime/services/activity-session-store.service.ts`
  Create an `@Injectable()` class that owns the in-memory activity map and absorbs grace timer management from `GraceTimerManager`.

  **Map CRUD** (mirrors the `PresenceService` pattern wrapping `presenceMap`):
  - `get(userId): ActivityState | undefined`
  - `has(userId): boolean`
  - `set(userId, state): void`
  - `delete(userId): boolean`
  - `get size(): number`

  **Grace timer** (absorb the three methods from `GraceTimerManager` — renamed to be self-documenting on the new class):
  - `startTimer` → `startGraceTimer`
  - `cancelTimer` → `cancelGraceTimer`
  - `hasPendingTimer` → `hasPendingGraceTimer`

  Move the private `timers` map and `graceMs` config read (`WS_RECONNECT_GRACE_MS`) from `GraceTimerManager`. Keep the exact same internal semantics (double-start cancels previous, cancel is no-op when absent, timer self-cleans from map on fire).

  The class has one injected dependency: `ConfigService` (for `WS_RECONNECT_GRACE_MS`). No logger needed — callers log outcomes.

### Phase 2: Rewire core and transports

- [x] **Task 2: Update `ActivityEngine` to use `ActivitySessionStore`** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.ts`

  **Replace map access:** Change the constructor to inject `ActivitySessionStore` instead of `StateStore`. `ActivityEngine` has zero references to `socketMap`/`streamMap`/`presenceMap` — `StateStore` can be fully removed. Replace every `this.stateStore.activityMap.get/set/has/delete(...)` call with the corresponding `this.activitySessionStore.get/set/has/delete(...)` call. There are ~15 call sites across `startActivity`, `endActivity`, `onDisconnect`, `abandonActivity`, `stopActivity`, `pauseActivity`, `unpauseActivity`, `getActiveSession`, `resumeActivity`.

  **Add orchestration methods** that absorb the reconnect/disconnect logic currently duplicated in both `LiveGateway.handleConnection` and `LiveStreamGrpcController.setup/teardown`:

  `handleReconnect(userId): Promise<LiveSession | null>` —
  1. If `activitySessionStore.has(userId)` is false, return `null` (no pending session).
  2. Call `activitySessionStore.cancelGraceTimer(userId)`.
  3. Call `this.resumeActivity(userId)` and return the result.

  `handleTransportDisconnect(userId): Promise<void>` —
  1. Call `this.onDisconnect(userId)`.
  2. If `activitySessionStore.has(userId)`, call `activitySessionStore.startGraceTimer(userId, callback)` where the callback calls `this.abandonActivity(userId).catch(...)` with an error log.

  These two methods centralise the logic that was copy-pasted between WS and gRPC transports.

- [x] **Task 3: Simplify `LiveGateway`** (depends on Task 2)
  Files: `src/realtime/gateways/live.gateway.ts`

  **Remove `GraceTimerManager` injection.** Keep `StateStore` (still needed for `socketMap` — eviction logic in `handleConnection` and deletion in `handleDisconnect`).

  **`handleConnection`:** Replace the `if (this.stateStore.activityMap.has(userId))` block (lines 115-134) with a single call: `this.activityEngine.handleReconnect(userId)`. On success, emit `SESSION_STATE` with the returned session. Keep the existing `.catch()` handler.

  **`handleDisconnect`:** Replace the `this.activityEngine.onDisconnect(userId).then(...)` chain (lines 146-171) with `this.activityEngine.handleTransportDisconnect(userId)`. The grace timer start is now internal to `ActivityEngine`. Keep the `.catch()` wrapper.

  Remove the `GraceTimerManager` import.

- [x] **Task 4: Simplify `LiveStreamGrpcController`** (depends on Task 2)
  Files: `src/realtime/live-stream.grpc.controller.ts`

  **Remove injections:** Drop `StateStore` and `GraceTimerManager` from the constructor.

  **`setup()` reconnect block (lines 83-96):** Replace with `const session = await this.activityEngine.handleReconnect(userId)`. If session is returned, emit the `sessionState` response. Remove the direct `this.stateStore.activityMap.has()` and `this.graceTimerManager.cancelTimer()` calls.

  **Teardown (lines 137-149):** Replace the `onDisconnect` + `activityMap.has` + `startTimer` chain with a single `await this.activityEngine.handleTransportDisconnect(userId)`. Keep the `.catch()` wrapper.

  Remove `StateStore` and `GraceTimerManager` imports.

### Phase 3: Clean up

- [x] **Task 5: Remove old wiring, update module** (depends on Tasks 3, 4)
  Files: `src/realtime/state-store.ts`, `src/realtime/services/observability.service.ts`, `src/realtime/realtime.module.ts`, `src/realtime/services/grace-timer.service.ts`

  1. **`StateStore`** — remove the `activityMap` field and the `ActivityState` import. The class retains `socketMap`, `streamMap`, `presenceMap`.

  2. **`ObservabilityService`** — inject `ActivitySessionStore` alongside `StateStore`. Replace `this.stateStore.activityMap.size` with `this.activitySessionStore.size`.

  3. **`RealtimeModule`** — add `ActivitySessionStore` to `providers`. Remove `GraceTimerManager` from `providers`. Add `ActivitySessionStore` to `exports` (external modules that previously read `stateStore.activityMap` need access). Update imports.

  4. **Delete `src/realtime/services/grace-timer.service.ts`** — its logic now lives inside `ActivitySessionStore`. Verify no other file imports `GraceTimerManager` (only `LiveGateway`, `LiveStreamGrpcController`, and `RealtimeModule` did — all updated in prior tasks).

- [x] **Task 6: Update existing spec files** (depends on Tasks 2, 3, 5)
  Files: `src/realtime/services/activity-engine.service.spec.ts`, `src/realtime/gateways/live.gateway.spec.ts`, `src/realtime/services/grace-timer.service.spec.ts`

  Three existing spec files will break after the refactoring. Fix them:

  1. **`activity-engine.service.spec.ts`** — the constructor now injects `ActivitySessionStore` instead of `StateStore`. In `beforeEach`, replace `stateStore = new StateStore()` with a real `ActivitySessionStore` instance (it's a simple in-memory class — pass a mock `ConfigService`). Replace all ~15 `stateStore.activityMap.get/set/has/delete(...)` calls with `activitySessionStore.get/set/has/delete(...)`. Update the `new ActivityEngine(...)` call to pass `activitySessionStore` instead of `stateStore`. Update the imports at the top of the file.

  2. **`live.gateway.spec.ts`** — remove `GraceTimerManager` mock (`makeGraceTimerManager()` helper, the `graceTimerManager` variable, and all assertions referencing `graceTimerManager.*`). Remove `GraceTimerManager` from the `new LiveGateway(...)` constructor call. In the reconnect flow tests: replace `stateStore.activityMap.set(...)` with `activityEngine.handleReconnect.mockResolvedValue(session)` (reconnect logic is now inside `ActivityEngine`). Replace `graceTimerManager.cancelTimer` / `startTimer` assertions with `activityEngine.handleReconnect` / `handleTransportDisconnect` assertions. In `handleDisconnect` tests: replace `activityEngine.onDisconnect` assertions with `activityEngine.handleTransportDisconnect`. Add `handleReconnect` and `handleTransportDisconnect` to the `makeActivityEngine()` mock factory.

  3. **Delete `grace-timer.service.spec.ts`** — the source file it tests (`grace-timer.service.ts`) was deleted in Task 5. The spec becomes an orphan importing a non-existent module.

## Commit Plan
- **Commit 1** (after tasks 1-2): "Add ActivitySessionStore and rewire ActivityEngine"
- **Commit 2** (after tasks 3-6): "Migrate transports to ActivitySessionStore, remove GraceTimerManager, and update specs"
