# Plan: sync-stream.grpc.controller.ts — live push phase

## Context

Wire the live push phase of `WatchChanges` server-streaming RPC so that after replay completes, the stream receives real-time `ChangeEvent` messages. A new `SyncStreamService` handles event listening, debounce/batching, and per-user stream lifecycle — the controller delegates to it, staying thin per the architecture. The `fullResync` edge case (cursor invalidated by nightly purge) is already handled in the replay phase.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Extract live push logic into a service

- [x] **Task 1: Create `SyncStreamService`**
  Files: `src/realtime/services/sync-stream.service.ts`
  Create a new `@Injectable()` service that owns the live push lifecycle for a single user's gRPC stream. This service is responsible for:
  - Listening to `CHANGE_EVENT_LOGGED` events via `EventEmitter2` (injected in constructor)
  - Debounce/batching with 300ms trailing window (same pattern as `SyncNotifierService.onChangeLogged()` — `Map<userId, PendingEntry>` with `setTimeout`, no timer reset on subsequent events)
  - Registering/deregistering a per-user push callback

  Public API:
  ```typescript
  register(userId: string, push: (events: SyncEventDto[]) => void): void
  deregister(userId: string): void
  ```

  `register()` stores the `push` callback in a private `Map<string, { push, pending }>`. `deregister()` clears any pending debounce timer and removes the entry.

  The `@OnEvent(CHANGE_EVENT_LOGGED)` handler checks if the user has a registered callback. If yes, it buffers the event and starts a 300ms timer (same logic as `SyncNotifierService`). When the timer fires, it calls `push(bufferedEvents)`.

  Event-to-DTO mapping: `{ id: payload.id, entity: payload.entity, refId: payload.refId, action: payload.action }`. Do NOT add `createdAt` here — the field is not available on `ChangeEventPayload`. The `createdAt` will be resolved in the controller (Task 3).

  Implement `OnModuleDestroy` — clear all pending timers on shutdown, same as `SyncNotifierService.onModuleDestroy()`.

  Import `CHANGE_EVENT_LOGGED` and `ChangeEventPayload` from `src/changelog`.

- [x] **Task 2: Register `SyncStreamService` in `RealtimeModule`**
  Files: `src/realtime/realtime.module.ts`
  Add `SyncStreamService` to the `providers` array. No export needed — it is only consumed by `SyncStreamGrpcController` within the same module.

### Phase 2: Wire controller to service with gap-free catchup-to-live

- [x] **Task 3: Rewrite controller — gap-free live push via `SyncStreamService`**
  Files: `src/realtime/sync-stream.grpc.controller.ts`
  Replace the current placeholder teardown and add live push wiring. The critical requirement is **no gap** between replay end and live listener registration.

  Inject `SyncStreamService` into the controller constructor alongside the existing `ChangeLogService`:
  ```typescript
  constructor(
    private readonly changeLogService: ChangeLogService,
    private readonly syncStreamService: SyncStreamService,
  ) {}
  ```

  Inside the Observable constructor, implement the following sequence:

  **Step A — Register listener BEFORE replay.** Call `syncStreamService.register(userId, pushFn)` immediately (before `replay()` starts). The `pushFn` callback pushes events into a local `liveBuffer: SyncEventDto[]` array. Do NOT call `subscriber.next()` yet — events are just buffered.

  **Step B — Run replay.** Execute the existing replay loop. Track the last replayed cursor in a local variable `lastReplayedCursor`. Skip empty batches: only call `subscriber.next()` when `result.events.length > 0`. If replay errors with `FAILED_PRECONDITION`, call `syncStreamService.deregister(userId)` before returning — do NOT leave a dangling listener.

  **Step C — Flush buffered live events.** After replay completes, drain `liveBuffer`: filter out events with `id <= lastReplayedCursor` (they were already sent during replay). If any remain, call `subscriber.next({ events: filteredEvents })`. Then switch the `pushFn` from buffering mode to direct mode — it now calls `subscriber.next({ events })` directly.

  For `createdAt` on live events: use `new Date().toISOString()`. This is acceptable because `CHANGE_EVENT_LOGGED` fires immediately after insert — the timestamp difference from the DB `createdAt` is negligible. Add a code comment explaining this decision.

  For live-only mode (`afterId === undefined`): skip replay entirely, set `lastReplayedCursor = 0`, and immediately switch `pushFn` to direct mode (no buffering needed since there's no replay to overlap with). Still register the listener first.

  **Step D — Teardown.** In `subscriber.add(() => { ... })`, call `syncStreamService.deregister(userId)`. This cleans up the event listener and any pending debounce timer. No need to touch `stateStore.streamMap` — this plan uses the callback-based approach, not `streamMap`.

- [x] **Task 4: Remove `streamMap` registration from this controller's scope**
  Files: `src/realtime/sync-stream.grpc.controller.ts`
  Verify the controller does NOT register anything in `stateStore.streamMap`. The `streamMap` in `StateStore` exists for `LiveSession` / `TelemetryStream` gRPC controllers (future work). `WatchChanges` uses `SyncStreamService`'s callback-based approach instead. If any `streamMap` references crept in during Task 3, remove them. `StateStore` should NOT be injected in this controller.
