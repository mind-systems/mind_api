# Plan: Add `ActivityEngine.abandonStale(userId, sessionId)` — finalize regardless of `DISCONNECTED`

## Context
Add an abandon path on `ActivityEngine` that finalizes a stale session from `ACTIVE` **or** `DISCONNECTED` (the existing `abandonActivity` only finalizes from `DISCONNECTED`), routed through `SessionEvents.ABANDONED` so both stream engines flush and drop their buffers. This is the building block for the Phase 42 idle-session watchdog (the periodic sweep is a separate milestone).

## Settings
- Testing: yes (milestone explicitly requires unit tests for the three branches)
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Implementation

- [x] **Task 1: Add `abandonStale(userId, sessionId)` to `ActivityEngine`**
  Files: `src/realtime/services/activity-engine.service.ts`
  Add `async abandonStale(userId: string, sessionId: string): Promise<void>` (place it next to `abandonActivity`, ~line 195). Unlike `abandonActivity` it is keyed by the `sessionId` argument, not by reading the in-memory store first — the watchdog may call it for a DB-only row absent from `activitySessionStore`.
  Behavior:
  1. Re-fetch the row: `const session = await this.repo.findOne({ where: { id: sessionId } });`. If not found, `this.activitySessionStore.delete(userId)` and `return` (nothing to abandon; clear any lingering store entry).
  2. **Already-finalized guard:** if `session.status` is `COMPLETED`, `INTERRUPTED`, or `ABANDONED`, no-op — `this.activitySessionStore.delete(userId)` to clear any lingering in-memory state, then `return`. Do **not** emit. This makes a double-fire with the grace timer (`abandonActivity`) safe.
  3. Otherwise (status is `ACTIVE` or `DISCONNECTED`): set `session.status = SessionStatus.ABANDONED`, `session.endedAt = now`, `const saved = await this.repo.save(session);`.
  4. Push the stream marker: `this.streamEngine.push(sessionId, { timestamp: Date.now(), data: { dataType: StreamDataType.SESSION_EVENT, event: StreamSessionEvent.ABANDONED } });` — note this uses the `sessionId` argument (not store state), so it also works for a DB-only row.
  5. `this.activitySessionStore.delete(userId);` (harmless no-op if the user has no store entry — the DB-only case).
  6. Log a `this.logger.log(...)` line mirroring `abandonActivity` (include `userId`, `sessionId`, `durationMs`).
  7. Emit: `this.eventEmitter.emit(SessionEvents.ABANDONED, { sessionId: saved.id, userId, startedAt: saved.startedAt, endedAt: saved.endedAt, activityType: saved.activityType, activityRefId: saved.activityRefId });` so the `@OnEvent(SessionEvents.ABANDONED)` handlers in `StreamEngine` (`stream-engine.service.ts:196`) and `BiometricStreamEngine` (`biometric-stream-engine.service.ts:216`) flush + `buffers.delete`.
  Constraints: must route through `eventEmitter.emit(SessionEvents.ABANDONED, …)` — a bare `repo.update`/`repo.save` would leave both engines' buffer maps populated forever (they are only cleared by the `ABANDONED`/`COMPLETED`/`INTERRUPTED`/`REVOKED` handlers). Read-only on `lastActivityAt` — never write it here. Reuse existing imports (`SessionStatus`, `StreamDataType`, `StreamSessionEvent`, `SessionEvents`) — no new imports needed.

### Phase 2: Tests

- [x] **Task 2: Unit-test the three branches of `abandonStale`** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.spec.ts`
  Add a `describe('abandonStale', …)` block mirroring the existing `abandonActivity` tests (same `makeRepo`/`makeEmitter`/`makeStreamEngine`/`makeActivitySessionStore`/`makeSession` helpers). Cover:
  - **(a) stale `ACTIVE` row → abandoned + emitted + store cleared:** seed an `ACTIVE` session via `makeSession({ status: SessionStatus.ACTIVE })`, set a matching store entry for `user-1`, `repo.findOne.mockResolvedValue(session)`, `repo.save.mockResolvedValue({ ...session, status: ABANDONED, endedAt })`. Call `engine.abandonStale('user-1', 'session-1')`. Assert `session.status === SessionStatus.ABANDONED`, `session.endedAt` defined, `activitySessionStore.has('user-1') === false`, `streamEngine.push` called for `'session-1'`, and `emitter.emit` called with `SessionEvents.ABANDONED` + `objectContaining({ sessionId: 'session-1', userId: 'user-1' })`.
  - **(b) already-`COMPLETED` row → no-op, no event:** `makeSession({ status: SessionStatus.COMPLETED })`, `repo.findOne.mockResolvedValue(session)`. Call `abandonStale`. Assert `repo.save` not called and `emitter.emit` not called (store cleared is fine to assert too).
  - **(c) DB-only row not in store → row updated + emitted:** do **not** set any store entry for the user; `repo.findOne.mockResolvedValue(makeSession({ status: SessionStatus.ACTIVE }))`, `repo.save.mockResolvedValue(...)`. Call `abandonStale('user-1', 'session-1')`. Assert `repo.save` called, `streamEngine.push` called for `'session-1'`, and `emitter.emit` called with `SessionEvents.ABANDONED`.
  Run `npx jest src/realtime/services/activity-engine.service.spec.ts` to confirm green.
