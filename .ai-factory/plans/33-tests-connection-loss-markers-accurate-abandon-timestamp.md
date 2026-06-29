# Plan: Tests — connection-loss markers + accurate abandon timestamp

## Context
Add silent-bug-first TDD tests (committed RED) to `activity-engine.service.spec.ts` that guard two gaps: a dropped connection leaves no timeline marker, and a grace-abandon records `endedAt = now` (inflated by the grace window). Target cases stay RED until spec `23-connection-loss-markers` lands; characterization cases lock current behavior and must stay GREEN.

## Settings
- Testing: yes (this milestone's deliverable is test code only)
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Scaffolding + characterization (must stay GREEN)

- [x] **Task 1: Add multi-session seeding scaffolding to the spec**
  Files: `src/realtime/services/activity-engine.service.spec.ts`
  Add a top-level `describe('connection-loss', ...)` (or extend the file) with a helper that seeds a **real** `ActivitySessionStore` for a root + ≥2 children, mirroring the existing `makeActivitySessionStore()` setup already in the file (`:30-36`). Use `activitySessionStore.setRoot(userId, rootId, state)` and `activitySessionStore.addChild(userId, childId, state)` so `getRootId`/`listChildren`/`getSession` resolve a root + 2 children (signatures confirmed in `activity-session-store.service.ts:65,92`). Reuse the existing `makeSession()` / `makeStreamEngine()` / `makeRepo()` helpers and the `beforeEach` wiring (`:59-71`).
  **Grace-timer hygiene:** `handleTransportDisconnect` arms real 30s `setTimeout` grace timers via the real store (`activity-session-store.service.ts:140-150`). To avoid dangling handles, after each `handleTransportDisconnect` assertion call `activitySessionStore.cancelGraceTimerForSession(id)` for the root and every seeded child (or guard the whole describe with `jest.useFakeTimers()` + `afterEach` clearing). Do not advance timers — `abandonActivity` on expiry must never fire inside these tests.
  No production source is edited in this milestone.

- [x] **Task 2: Characterization tests — locked current behavior (GREEN now, GREEN after note 23)** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.spec.ts`
  Add cases asserting behavior note 23 must NOT change. Label these plainly (no "RED" tag) — a red here after note 23 is a genuine regression (escalate, do not patch):
  - `handleTransportDisconnect` (current source `activity-engine.service.ts:~672`) still calls `repo.update(sid, { status: DISCONNECTED, disconnectedAt })` for the root and **each** child (per-session `onDisconnect` at `:~299`), and arms a grace timer per session — assert `hasPendingGraceTimerForSession(id)` is true for root + each child afterwards (then cancel them per Task 1).
  - `abandonStale` (separate method, `:~365`; `endedAt = now` at `:~388`) on a **never-disconnected** stale `ACTIVE` row (`disconnectedAt = null`) still saves `endedAt ≈ now` — assert the `repo.save` argument's `endedAt` falls within a `before`/`after` `Date.now()` window (the `now` fallback must survive). Mock `repo.findOne` → the `ACTIVE` session, `repo.save` → echo.
  - Existing discrete markers unchanged: assert `streamEngine.push` fires `data.dataType === StreamDataType.SESSION_EVENT` with `event === StreamSessionEvent.STARTED` for `startActivity`, `ENDED` for `endActivity`, `PAUSED` for `pauseActivity`, `RESUMED` for `unpauseActivity`, `ABANDONED` for `abandonActivity` (these enum members exist today). Seed a child via `addChild` for the pause/unpause paths (they reject root and use `getSession`). Keep these minimal — several are already partly covered by the existing `startActivity`/`endActivity`/`abandonActivity` describes; add only what is not already asserted, do not duplicate.

### Phase 2: Target tests (RED until spec 23-connection-loss-markers)

- [x] **Task 3: Target — disconnect/reconnect markers emitted once on the root** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.spec.ts`
  Title these cases `RED until spec 23-connection-loss-markers` (use real `it`, never `it.skip` — they must run and fail until note 23). Use the **literal strings** `'disconnected'` / `'reconnected'` (the `StreamSessionEvent.DISCONNECTED`/`RECONNECTED` enum members do NOT exist yet — `stream-data-types.ts:6-13` — referencing them would break compilation). Keep `data.dataType === StreamDataType.SESSION_EVENT` (that enum value exists).
  - **Spam guard (load-bearing):** seed root + 2 children, run `await engine.handleTransportDisconnect(userId)`, then assert that among `streamEngine.push.mock.calls`, **exactly one** has `data.event === 'disconnected'` AND its first arg (`sessionId`) `=== rootId` — never per-child. (Currently `handleTransportDisconnect` at `:~672` emits no marker, so the count is 0 → RED now; GREEN once note 23 emits once on the root.)
  - **Reconnect marker:** seed root + children with `DISCONNECTED` DB rows (`repo.findOne` → disconnected session, `repo.save` echoes), run `await engine.handleReconnect(userId, clientSessionId)` (`:~629`), assert **exactly one** push with `data.event === 'reconnected'` keyed to `rootId`. (No reconnect marker today → RED now.)

- [x] **Task 4: Target — abandonActivity uses disconnectedAt, not now** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.spec.ts`
  Title `RED until spec 23-connection-loss-markers`. Seed a child in the store; mock `repo.findOne` to return a session with `status: SessionStatus.DISCONNECTED` and a concrete `disconnectedAt` (e.g. 30s in the past); have `repo.save` echo its argument. Run `await engine.abandonActivity(userId, sessionId)` and assert the `repo.save` argument's `endedAt` **equals the fixture's `disconnectedAt`** (capture via `repo.save.mockImplementation`). Currently `abandonActivity` (`:~316`) sets `session.endedAt = now` (`:~339`) → assertion fails RED now; note 23 changes it to `disconnectedAt ?? now` → GREEN. Do not touch / assert against `abandonStale` here — its `now` fallback is the separate characterization in Task 2.

## Notes for the implementer
- **Do NOT implement the feature.** This milestone writes tests only; spec `23-connection-loss-markers` (the enum members, the root marker emissions, and the `endedAt = disconnectedAt ?? now` change) lands in a later, separate task. The Phase 2 target tests are expected to fail when committed.
- The spec note's source line numbers (`:631`, `:588`, `:275`, etc.) predate the current file; the live locations are pinned above (`handleTransportDisconnect ~:672`, `handleReconnect ~:629`, `abandonActivity ~:316`/`endedAt :339`, `abandonStale ~:365`/`:388`, `onDisconnect ~:299`). Re-read before asserting.
- Observe only mock-visible outcomes: the `streamEngine.push` call (`sessionId` arg + `data.event`/`data.dataType`) and the `repo.save` argument. Never inspect private buffers or the store's internal maps.
- If a Phase 2 spam-guard case stays RED *after* note 23 because note 23 emitted per-session instead of once-on-root, that is a feature defect to escalate to note 23 — do not weaken the assertion.

## Commit Plan
- **Commit 1** (after tasks 1-4): "Add connection-loss marker and abandon-timestamp engine tests (RED until spec 23)"
