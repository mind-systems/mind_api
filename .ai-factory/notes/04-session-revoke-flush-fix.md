# Session-Revoke Flush Fix

**Date:** 2026-05-23
**Status:** decisions locked, ready to decompose
**Pairs with:** `.ai-factory/notes/03-biometric-stream-service.md` (this fix is a prerequisite for that phase — biometric engine must inherit the same listener from day one).

## Problem

`ModuleStateGrpcController.handleSessionRevoked` (`src/realtime/module-state.grpc.controller.ts:165-176`) currently:

```ts
@OnEvent(AuthEvents.SESSION_REVOKED)
async handleSessionRevoked(payload) {
  try { await this.activityEngine.stopActivity(payload.userId); }
  catch (err) { this.logger.error(...) }
  this.activeStreamRegistry.closeAll(payload.userId);
}
```

The happy path: `stopActivity` runs `ActivityEngine.stopActivity` which emits `SessionEvents.INTERRUPTED` (`src/realtime/services/activity-engine.service.ts:236`). `StreamEngine.onSessionInterrupted` listens, flushes the buffer, deletes it. Then `closeAll` terminates the subscribers.

The bug: if `stopActivity` throws, the catch logs the error but no `INTERRUPTED` event is emitted. `closeAll` then immediately terminates the subscribers. The in-memory buffer waits for the next periodic flush (5 s by default) or is lost if the process dies before the timer fires. Phase 19 (bio stream) doubles the data at risk.

## Fix

Add a new lifecycle event `SessionEvents.REVOKED` that fires unconditionally from `handleSessionRevoked`. Both engines (the existing `StreamEngine` and the upcoming `BiometricStreamEngine`) treat it identically to `INTERRUPTED`: flush, then drop the buffer.

### Why a new event, not reusing `INTERRUPTED`

`INTERRUPTED` is owned by `ActivityEngine` and means "the user pressed Stop." Emitting it from `handleSessionRevoked` would conflate "user-initiated stop" with "auth revocation" — same downstream flush behavior, different semantics, and analytics or future listeners could care about the distinction. Cheaper to add a sibling event than to overload one.

### Why not flush directly via injected engine refs

Would require `ModuleStateGrpcController` to depend on both `StreamEngine` and (later) `BiometricStreamEngine`. Cross-controller coupling that grows with every new buffered stream. Event-based fan-out scales without that.

### Emit-only-in-catch (avoids race with `INTERRUPTED` flush)

A naive design would emit `REVOKED` unconditionally after `stopActivity`. That is **broken**.

On the happy path `ActivityEngine.stopActivity` reaches its last line (`activity-engine.service.ts:236`) and emits `SessionEvents.INTERRUPTED`. `eventEmitter.emit` in `@nestjs/event-emitter` is synchronous fire-and-forget for the dispatch — listeners are invoked in order, but the call returns before any async handler body completes. `StreamEngine.onSessionInterrupted` starts an async `flush`, which immediately does `const samples = buffer.samples.slice()` and then `await sampleRepo.save(...)`. The crucial detail: `buffer.samples = []` is set **after** the awaited save (`stream-engine.service.ts:123-136`, comment: "Clear only after successful save — preserves data on DB error"). Until the save resolves, the buffer is still non-empty.

If `handleSessionRevoked` then unconditionally emits `REVOKED`, a second handler starts, slices the same non-empty `buffer.samples`, fires a second `sampleRepo.save`, and the same batch of samples lands in `session_stream_samples` (and, after Phase 19, in `bio_session_samples`) twice. Time-join analytics over-counts.

The fix: emit `REVOKED` **only when `stopActivity` failed** — i.e. inside the catch block. On the happy path `INTERRUPTED` was emitted from inside `stopActivity` and the flush is in flight; no second signal is needed. On the failure path `stopActivity` threw before line 236, so `INTERRUPTED` was never emitted — `REVOKED` is the only flush trigger and there is no in-flight handler to race against.

### `userId` → `sessionId` resolution

`SessionEvents.COMPLETED/ABANDONED/INTERRUPTED` payloads carry `{ sessionId }`. The `REVOKED` event also needs to carry `sessionId` so engines can locate the right buffer. `handleSessionRevoked` only has `userId` in the payload — it must resolve `sessionId` before clearing in-memory state. Source of truth: `ActivityEngine.getActiveSession(userId): ActivityState | undefined` (`activity-engine.service.ts:312-314`).

Order:

1. Resolve `sessionId = activityEngine.getActiveSession(userId)?.sessionId` **before** calling `stopActivity` (which clears in-memory state via `activitySessionStore.delete(userId)` on its success path).
2. `try { await stopActivity(userId) }`.
3. **Inside catch only**: log the original error; if `sessionId` was non-null, `eventEmitter.emit(SessionEvents.REVOKED, { sessionId })`.
4. `closeAll(userId)`.

### Edge case: `stopActivity` returns `null` without throwing

If `stopActivity` finds no in-memory state or no DB row (`activity-engine.service.ts:80-96, 210-214`), it returns `null` — no throw, catch doesn't fire, no `REVOKED` emit. This is correct: with no `module_sessions` row there is no valid `moduleSessionId` to write the buffer against (FK would fail). Any stale in-memory buffer for a non-existent session is a separate cleanup concern, not Phase 18's scope.

### Payload shape

```
SessionEvents.REVOKED → { sessionId: string }
```

Same shape as `INTERRUPTED`/`COMPLETED`/`ABANDONED`. Engines reuse their handler signature.

## Touch list

- `src/realtime/events/session.events.ts` — add `REVOKED: 'session.revoked'`.
- `src/realtime/module-state.grpc.controller.ts` — inject `EventEmitter2`, rewrite `handleSessionRevoked` per the order above.
- `src/realtime/services/stream-engine.service.ts` — add `@OnEvent(SessionEvents.REVOKED) onSessionRevoked(payload)` handler — copy/paste `onSessionInterrupted` body verbatim, only the log message differs.

The biometric engine task in Phase 19 will register the same handler from day one — note 03 §5 already lists `COMPLETED | ABANDONED | INTERRUPTED`; update to add `REVOKED`.

## Tests (separate `ROADMAP_TESTS.md` — not part of this phase)

- `StreamEngine.onSessionRevoked` flushes and clears buffer (mirror existing `onSessionInterrupted` spec).
- `handleSessionRevoked` emits `REVOKED` even when `stopActivity` throws.
- `handleSessionRevoked` resolves `sessionId` from `ActivityEngine` before clearing state.
- `handleSessionRevoked` does not emit `REVOKED` if the user had no active session.
