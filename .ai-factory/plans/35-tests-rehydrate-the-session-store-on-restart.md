# Plan: Tests — rehydrate the session store on restart

## Context
Rewrite `startup-recovery.service.spec.ts` (TDD, committed RED) to pin the *rehydration* contract that feature note 26 will implement: bootstrap rebuilds the `ActivitySessionStore` (`setRoot`/`addChild` linked by `rootSessionId`), marks rows `DISCONNECTED` (`disconnectedAt = lastActivityAt`), arms grace from process start via `store.startGraceTimerForSession` (expiry → `engine.abandonActivity`), and derives `isPaused` from each session's last `PAUSED`/`RESUMED` marker in `session_stream_samples` — inverting the current bulk-abandon spec.

## Settings
- Testing: yes (this milestone *is* the test surface — target cases stay RED until note 26 lands)
- Logging: minimal
- Docs: no

## Ground-truth facts (verified against source — use these exact shapes)

- **Current ctor:** `StartupRecoveryService(repo: Repository<ModuleSession>)` only (`startup-recovery.service.ts:11-14`). Note 26 will widen to `(repo, streamSampleRepo, activitySessionStore, activityEngine)`. Until then, construct via `new (StartupRecoveryService as any)(repo, streamSampleRepo, store, engine)` to bypass the arity check (spec note L2/gotcha).
- **Store spies** (`activity-session-store.service.ts`): `setRoot(userId, sessionId, state?)` (:65), `addChild(userId, sessionId, state)` (:92), `getRootId(userId)` (:79), `startGraceTimerForSession(sessionId, onExpiry)` (:140 — captures the `onExpiry` callback, fires after `graceMs`). Grace arming is now-relative here — the load-bearing "from process start" contract is that the service calls **this** method, not a hand-rolled `setTimeout(lastActivityAt + grace − now)`.
- **Engine spy** (`activity-engine.service.ts:316`): `abandonActivity(userId, sessionId?)` — the consistent-abandon path (writes marker + emits `SessionEvents.ABANDONED`).
- **`ActivityState` shape** (`interfaces/activity-state.interface.ts`): `{ sessionId, activityType, activityRefId?, rootSessionId?, startedAt, lastActivityAt, isPaused }`. Assert the `state` args to `setRoot`/`addChild` against this (esp. `isPaused` and `rootSessionId`).
- **Persisted sample shape** — GROUND TRUTH, use this, not note 29's simplified `{ event, timestamp }`: `session_stream_samples.samples` is a jsonb array of `InstructionSample` = `{ timestamp: number, data: { dataType: 'session_event', event: string } }` (`interfaces/session-buffer.interface.ts`, push site `activity-engine.service.ts:268-274`). Pause markers are `data.event === 'paused'` / `'resumed'` (`constants/stream-data-types.ts:11-12` — `StreamSessionEvent.PAUSED='paused'`, `RESUMED='resumed'`, `dataType='session_event'`). To derive `isPaused`, the last sample whose `data.dataType==='session_event'` and `data.event` ∈ {paused,resumed} decides it. Mock rows this way so the test survives note 26's real derive.
- **`streamSampleRepo`** is `Repository<SessionStreamSample>`; mock `find({ where: { moduleSessionId } })` to return rows with `samples` arrays.
- **`SessionStatus`** enum (`enums/session-status.enum.ts`): `ACTIVE`, `DISCONNECTED`, `ABANDONED`. `RESUMED='resumed'` here is a status value — unrelated to the pause marker; do not confuse it with the stream-sample `event`.

## Tasks

### Phase 1: Rewrite the startup-recovery spec

- [x] **Task 1: Replace the test harness — new ctor arity, mocks, and builders**
  Files: `src/realtime/services/startup-recovery.service.spec.ts`
  Rebuild the `beforeEach` setup: mock `repo` (`find`/`save`/`update`), `streamSampleRepo` (`find`), `store` (`setRoot`/`addChild`/`getRootId`/`startGraceTimerForSession` jest spies), `engine` (`abandonActivity` jest spy). Instantiate with `new (StartupRecoveryService as any)(repo, streamSampleRepo, store, engine)` (the `as any` cast bypasses today's single-arg ctor — pin this until note 26 widens it; a LOUD DI failure if arity drifts). Extend `makeSession` to accept `rootSessionId`/`id`/`lastActivityAt` overrides so a root row and its children can be linked by `rootSessionId = root.id`. Add a `makeSampleRow(moduleSessionId, events)` helper that emits rows with the ground-truth `samples` shape `{ timestamp, data: { dataType: 'session_event', event } }`.

- [x] **Task 2: Invert the bulk-abandon anti-target into store-reconstruction cases** (depends on Task 1)
  Files: `src/realtime/services/startup-recovery.service.spec.ts`
  DELETE the existing `it('abandons orphan sessions on bootstrap')` (`:29-53`) — it pins the removed bulk-abandon behavior. Replace with target cases labeled `RED until spec 26-state-rehydration`:
  (a) Given `repo.find` returns a root row + 2 child rows (`rootSessionId = root.id`), bootstrap calls `store.setRoot(userId, root.id, …)` once and `store.addChild(userId, child.id, …)` per child; assert `repo.save` is **not** called with `status: SessionStatus.ABANDONED`.
  (b) Each rehydrated row is marked `DISCONNECTED` with `disconnectedAt = lastActivityAt` — assert the `repo.save`/`repo.update` argument (accept either persistence call).
  Assert `setRoot`/`addChild` `state` args match `ActivityState` (correct `rootSessionId` linkage).

- [x] **Task 3: Add pause-derive cases** (depends on Task 1)
  Files: `src/realtime/services/startup-recovery.service.spec.ts`
  Target cases (`RED until spec 26-state-rehydration`). Mock `streamSampleRepo.find({ where: { moduleSessionId: child.id } })` per child:
  (a) last pause-related sample `data.event === 'paused'` → the child is re-added with `state.isPaused === true` (assert the `store.addChild` state arg).
  (b) last pause-related event `'resumed'`, and separately a row with no pause marker at all → `state.isPaused === false`. No column, no `as any` on the value — it comes from the mocked marker rows.

- [x] **Task 4: Add grace-from-process-start cases + keep empty-set characterization** (depends on Task 1)
  Files: `src/realtime/services/startup-recovery.service.spec.ts`
  Target case (`RED until spec 26-state-rehydration`): `store.startGraceTimerForSession(sid, onExpiry)` is called per rehydrated session (assert arming via this method — NOT a hand-rolled `setTimeout(lastActivityAt + grace − now)`; that distinction is the "from process start" contract). Capture the `onExpiry` callback from the spy and invoke it: assert it calls `engine.abandonActivity(userId, sid)` (consistent abandon), not a silent bulk `repo.save`.
  KEEP the existing `it('does not call repo.save when no orphan sessions found')` (`:55-61`) as characterization; broaden it to also assert no `store.*` and no `engine.abandonActivity` calls on an empty `repo.find`.

## Notes for the implementer
- All target cases are expected to FAIL now (RED) — that is correct; they turn GREEN when note 26 lands. Do NOT weaken assertions to make them pass against today's service.
- The empty-set no-op case must stay GREEN today (characterization). If it goes RED, that is a regression — escalate.
- The "no duplicate root on reconnect" guard and the real DB restart round-trip are the **manual checklist**, not unit cases — do not attempt to unit-test them here (they need the real `ensureRoot`/store round-trip). Record them as the manual checklist per note 29.
- Single commit at the end (all edits land in one file): "Rewrite startup-recovery spec for session-store rehydration".
