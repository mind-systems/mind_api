# Test plan — rehydrate the session store on restart (silent-bug-first, TDD)

**Date:** 2026-06-29
**Source:** conversation context

Covers feature task [[26-state-rehydration]]. Written **before** the feature: committed RED, turns GREEN when note 26 lands.

## Test authoring constraints
- **L1 — outcomes only:** assert mock-visible calls — `store.setRoot` / `store.addChild` / `store.startGraceTimerForSession`, `engine.abandonActivity`, and `repo.save`/`repo.update` arguments. Never inspect the store's private maps.
- **L2 — compile-now:** `StartupRecoveryService` today injects **only** `repo` (`startup-recovery.service.ts`). Note 26 adds `streamSampleRepo` (`Repository<SessionStreamSample>`, for the pause derive), `ActivitySessionStore`, and `ActivityEngine`. Until it lands, construct via `new (StartupRecoveryService as any)(repo, streamSampleRepo, store, engine)` to bypass the arity check, and provide the new deps as mocks.
- **L3 — label by spec name:** target cases `RED until spec 26-state-rehydration`.
- **L4 — escalation valve:** the empty-bootstrap no-op and graceful-shutdown flush are characterization. A RED there after note 26 = regression, escalate.

## Why this area (silent-failure filter — highest blast radius)
Today `StartupRecoveryService.onApplicationBootstrap` **bulk-abandons** every `ACTIVE`/`DISCONNECTED` session on boot. After a restart this silently: severs in-flight work (the empty store makes `handleReconnect` find nothing), mints a duplicate root via `ensureRoot`, loses pause, and abandons sessions with **no** marker and **no** `SessionEvents.ABANDONED` (unlike the grace path). All silent — no error, just wrong state.

## Behavior under change — think before writing
Rehydrate must reuse the **existing** reconnect/grace machinery: rebuild the store, mark rows `DISCONNECTED`, arm a grace timer **from process start**, and let the existing `handleReconnect` resume returners and the existing grace timer abandon the rest consistently. Re-derive: a root + its children must be re-linked by `rootSessionId`; `isPaused` **derived** from each child's last `PAUSED`/`RESUMED` marker in `session_stream_samples` ([[25-persist-ispaused]] — no column); grace armed now-relative (not `lastActivityAt + grace`).

## Unit vs manual split
- **Unit-testable (this milestone):** store reconstruction, grace arming + its expiry callback, pause derive (from mocked marker rows), and the no-bulk-abandon inversion — all observable through mocked `store`/`repo`/`streamSampleRepo`/`engine`.
- **Manual checklist (no DB/integration test, consistent with how the windowed read + migration were verified):** the real restart round-trip — start a practice, restart the server, reconnect within grace resolves the **same** root + child ids (no duplicate `ensureRoot` root), a paused session returns paused, and an unreturned session is abandoned after grace. State these as the manual checklist, not unit cases.

## Red/Green contract
- **Target (RED until [[26-state-rehydration]]):** the rebuild + grace + pause-derive + consistent-abandon below.
- **Characterization (GREEN, stay GREEN):** empty-set bootstrap is a no-op; graceful-shutdown buffer flush (`onApplicationShutdown → flushAll`, owned by the stream engines) is untouched; the empty-root janitor still reaps a rehydrated childless root no client reclaims (cross-spec — `session-watchdog`).

## Instantiation
`StartupRecoveryService` — current ctor `(repo)`; note 26 → `(repo, streamSampleRepo, activitySessionStore, activityEngine)` (pin this arity; escalate). Mocks: `repo` (`Repository<ModuleSession>` — `find`/`save`/`update`), `streamSampleRepo` (`Repository<SessionStreamSample>` — `find` returning rows with `samples` arrays, for the pause derive), `ActivitySessionStore` with `setRoot(userId, sessionId, state?)` / `addChild(userId, sessionId, state)` / `getRootId` / `startGraceTimerForSession(sessionId, onExpiry)` spies (`activity-session-store.service.ts:65,92,79,162`), `ActivityEngine` with `abandonActivity(userId, sessionId?)` spy (`activity-engine.service.ts:275`).

## Test cases
### Store reconstruction (target → 26)
- Given `repo.find` returns a root row + 2 child rows (`rootSessionId = root.id`), bootstrap calls `store.setRoot(userId, root.id, …)` once and `store.addChild(userId, child.id, …)` per child — instead of bulk-abandoning. Assert the calls; assert `repo.save` is **not** called with `status: ABANDONED`.
- Each rehydrated row is marked `DISCONNECTED` with `disconnectedAt = lastActivityAt` (assert the `repo.save`/`update` argument).
### Pause derive (target → 26)
- Mock `streamSampleRepo.find({ where: { moduleSessionId: child.id } })` to return a row whose `samples` last pause-related event is `'paused'` → the child is re-added with `state.isPaused === true` (assert the `store.addChild` state arg). RED now → GREEN after.
- Last pause event `'resumed'`, or no pause marker at all → `state.isPaused === false`. (No column, no `as any` cast — the value comes from the mocked marker rows.)
### Grace from process start (target → 26)
- `store.startGraceTimerForSession(sid, onExpiry)` is called per rehydrated session (now-relative arming — **not** a custom `setTimeout(lastActivityAt + grace − now)`). Capture the `onExpiry` callback and invoke it: it calls `engine.abandonActivity(userId, sid)` (consistent abandon = marker + `SessionEvents.ABANDONED`), not a silent bulk save.
### Unchanged (characterization)
- Empty `repo.find` result → no `store.*`/`repo.save` calls (the surviving no-op case).

## Anti-targets (DELETE or INVERT — enumerated by file:line)
- **`startup-recovery.service.spec.ts:29-53`** — `it('abandons orphan sessions on bootstrap')`, asserts `repo.save` called with `status: SessionStatus.ABANDONED` for the orphans (`:39-49`). This pins the **OLD bulk-abandon** behavior that note 26 removes. **DELETE or INVERT:** after note 26, bootstrap **rehydrates** (store calls + DISCONNECTED marking), and abandon happens only later via the grace timer's `abandonActivity` — not a boot-time bulk save.
- **`startup-recovery.service.spec.ts:55-61`** — `it('does not call repo.save when no orphan sessions found')` — **survives as characterization** (empty set → no-op). Keep it; optionally broaden to also assert no `store.*` calls. NOT an anti-target.

## Gotchas
- Compile-now: cast the class for the new ctor — `new (StartupRecoveryService as any)(repo, streamSampleRepo, store, engine)` — until note 26 changes the constructor (a LOUD DI change; pin the arity with note 26).
- The grace-source assertion is load-bearing: assert arming via `store.startGraceTimerForSession` (now-relative), NOT a hand-rolled expiry from `lastActivityAt` — that distinction is the "from process start" contract.
- The "no duplicate root on reconnect" guard is the **manual** checklist, not a unit case (it needs the real `ensureRoot`/store round-trip).
- The pause-derive case reads the mocked `streamSampleRepo` rows (note 25's durable markers) — no column, no `as any` cast. Mock the `samples` arrays with `{ event: 'paused'|'resumed', timestamp }` elements.

## Findings / escalation to note 26
1. Add `streamSampleRepo` (`Repository<SessionStreamSample>`), `ActivitySessionStore`, and `ActivityEngine` to the `StartupRecoveryService` ctor (pin arity).
2. Rebuild via `setRoot`/`addChild` (link by `rootSessionId`); mark `DISCONNECTED` with `disconnectedAt = lastActivityAt`; **derive** `isPaused` from each child's last `PAUSED`/`RESUMED` marker in `session_stream_samples` (no column).
3. Arm grace via `store.startGraceTimerForSession` (process-start-relative); expiry → `abandonActivity`.
4. Replace the bulk-abandon path; invert anti-target `startup-recovery.service.spec.ts:29-53`.
