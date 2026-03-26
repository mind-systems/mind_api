# Plan: Implement active-stream invalidation on logout

## Context
`SessionService.revoke()` deletes the `user_sessions` row, but any open gRPC stream (LiveSession, StreamTelemetry, WatchChanges) authenticated under that user continues until the client disconnects. This plan adds an in-memory stream registry that tracks all active gRPC stream subscribers per `userId` and forcibly completes them when `revoke()` fires, using the existing `EventEmitter2` bus as the decoupling mechanism between `AuthModule` and `RealtimeModule`.

**Design: revoke-one-kills-all** — the registry is keyed by `userId`, not by session/token. If a user has multiple sessions across devices, logging out from any one disconnects all active streams. Other sessions remain valid in the DB; the client reconnects and re-opens the stream. This is intentional — matching the roadmap item 6.1 scope.

**Design: clean interruption on logout** — when `SESSION_REVOKED` fires, the handler calls `activityEngine.stopActivity(userId)` _before_ completing subscribers. This transitions any active live session to INTERRUPTED immediately, instead of letting the teardown start a grace timer that would eventually mark it ABANDONED. After `stopActivity` clears the in-memory activity state, the teardown's `handleTransportDisconnect` finds no entry in `activitySessionStore` and skips the grace timer — only presence cleanup runs.

## Settings
- Testing: no (new tests) — but existing tests in `session.service.spec.ts` must be updated to avoid CI breakage
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Event and registry

- [x] **Task 1: Define `SESSION_REVOKED` event constant**
  Files: `src/users/events/auth.events.ts` (new)
  Create a new file exporting a constant for the event name used by both the emitter (`SessionService`) and the listener (`LiveStreamGrpcController`). Follow the pattern in `src/realtime/events/session.events.ts` — a plain `as const` object:
  ```
  export const AuthEvents = {
    SESSION_REVOKED: 'auth.session_revoked',
  } as const;
  ```
  Also export an interface for the event payload: `{ userId: string }`.

- [x] **Task 2: Create `ActiveStreamRegistry` service** (depends on Task 1)
  Files: `src/realtime/services/active-stream-registry.service.ts` (new), `src/realtime/realtime.module.ts`
  Create an `@Injectable()` service that:
  - Maintains a `Map<string, Set<Subscriber<any>>>` keyed by `userId`.
  - `register(userId: string, subscriber: Subscriber<any>): void` — adds the subscriber to the set for that user.
  - `deregister(userId: string, subscriber: Subscriber<any>): void` — removes the subscriber from the set; deletes the map entry if the set is empty.
  - `closeAll(userId: string): void` — iterates the subscriber set for that user, calls `subscriber.complete()` on each, and deletes the map entry. This is a plain public method, **not** an event handler — the event coordination lives in the controller (Task 4).
  - Implements `OnModuleDestroy`: on shutdown, completes all subscribers and clears the map (follow the `SyncStreamService` pattern).

  Register `ActiveStreamRegistry` in `RealtimeModule.providers`. It does not need to be exported — only the streaming controllers within `RealtimeModule` use it.

### Phase 2: Emit event on session revocation

- [x] **Task 3: Emit `SESSION_REVOKED` from `SessionService.revoke()`** (depends on Task 1)
  Files: `src/users/service/session.service.ts`
  - Inject `EventEmitter2` into `SessionService` constructor (add as second constructor parameter after `repo`).
  - In `revoke(token)`, before calling `this.repo.delete(...)`, look up the session row to obtain the `userId`:
    ```
    const session = await this.repo.findOne({ where: { tokenHash }, select: ['userId'] });
    ```
    If no row is found, return early (already revoked / expired — no event needed).
  - After successful `this.repo.delete(...)`, emit the event:
    ```
    this.eventEmitter.emit(AuthEvents.SESSION_REVOKED, { userId: session.userId });
    ```
  - Keep the existing log line. Do not log the userId (it's already implied by the session context, and RULES.md mandates lean logs).

- [x] **Task 4: Update `session.service.spec.ts` for new constructor and revoke behavior** (depends on Task 3)
  Files: `src/users/service/session.service.spec.ts`
  The spec constructs `SessionService` with only a `repo` mock (line 19). After Task 3, the constructor also requires an `EventEmitter2` instance. Update the spec:
  - Add a mock `EventEmitter2` with a `jest.fn()` for `emit`.
  - Pass both `repo` and the emitter mock to the constructor: `service = new (SessionService as any)(repo, emitter)`.
  - Add a `findOne` mock to `repo` that returns `{ userId: 'user-1' }` by default.
  - In the `revoke` describe block:
    - Update the "deletes session by token hash" test: mock `repo.findOne` to return a session, assert that `emit` is called with `AuthEvents.SESSION_REVOKED` and the correct `{ userId }` payload.
    - Update the "does not throw when session does not exist" test: mock `repo.findOne` to return `null`, assert that `emit` is **not** called and `repo.delete` is **not** called (early return).

### Phase 3: Wire streaming controllers

- [x] **Task 5: Register/deregister subscribers and handle `SESSION_REVOKED` in controllers** (depends on Tasks 2, 3)
  Files: `src/realtime/live-stream.grpc.controller.ts`, `src/realtime/telemetry-stream.grpc.controller.ts`, `src/realtime/sync-stream.grpc.controller.ts`

  **All three controllers** — inject `ActiveStreamRegistry` into each controller's constructor. In each streaming method's `new Observable(subscriber => { ... })` body:

  **LiveStreamGrpcController.liveSession** — after the `userId` variable is set (line 76) and before `setup()`, call `activeStreamRegistry.register(userId, subscriber)`. In the existing teardown callback (`subscriber.add(() => { ... })` at line 125), add `activeStreamRegistry.deregister(userId, subscriber)` as the first line.

  **TelemetryStreamGrpcController.streamTelemetry** — same pattern: after `userId` is set (line 47), call `register`. In the existing teardown (`subscriber.add` at line 138), add `deregister` before `sub.unsubscribe()`.

  **SyncStreamGrpcController.watchChanges** — after `userId` is set (line 39), call `register`. In the existing teardown (`subscriber.add` at line 127), add `deregister` before the `syncStreamService.deregister` call. The existing `SyncStreamService` tracking stays untouched — it handles a different concern (event push routing); `ActiveStreamRegistry` handles forced termination.

  **Event handler (LiveStreamGrpcController only)** — add an `@OnEvent(AuthEvents.SESSION_REVOKED)` handler method to `LiveStreamGrpcController`:
  ```typescript
  @OnEvent(AuthEvents.SESSION_REVOKED)
  async handleSessionRevoked(payload: { userId: string }): Promise<void> {
    await this.activityEngine.stopActivity(payload.userId);
    this.activeStreamRegistry.closeAll(payload.userId);
  }
  ```
  This lives on the live-stream controller because it already has `ActivityEngineService` injected and owns the activity lifecycle. Calling `stopActivity` before `closeAll` ensures any active live session transitions to INTERRUPTED cleanly, preventing the teardown from starting a pointless grace timer. After `stopActivity` clears the `activitySessionStore` entry, the teardown's `handleTransportDisconnect` finds nothing and only runs presence cleanup.

## Commit Plan
- **Commit 1** (after Tasks 1-2): "Add SESSION_REVOKED event constant and ActiveStreamRegistry service"
- **Commit 2** (after Tasks 3-5): "Emit SESSION_REVOKED on logout and wire stream invalidation in controllers"
