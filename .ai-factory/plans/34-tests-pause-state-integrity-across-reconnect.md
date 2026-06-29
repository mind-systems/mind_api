# Plan: Tests — pause-state integrity across reconnect

## Context
TDD test task guarding feature note 24: the server silently resets `isPaused` on reconnect and hardcodes `isPaused: false` in the reconnect emission, so a paused session returns active and the next `unpause` is rejected `NOT_PAUSED`. Author the tests now, committed **RED** (target cases) + **GREEN** (characterization); they flip GREEN when note 24 lands. Test-only — no production code changes.

## Settings
- Testing: yes (this milestone authors tests)
- Logging: minimal
- Docs: no

## Reconnaissance (already explored — use these anchors)

- **Engine spec:** `src/realtime/services/activity-engine.service.spec.ts`
  - Real `ActivitySessionStore` is used (`makeActivitySessionStore()`), engine built at `:65` as `new ActivityEngine(repo, activitySessionStore, emitter, streamEngine)`. `repo`, `emitter`, `streamEngine` are mocks.
  - `resumeActivity` describe block at `:620-673` (happy path seeds via `activitySessionStore.set(...)`, mocks `repo.findOne`/`repo.save`). Mirror this for new target cases.
  - Pause/unpause **marker** characterization already exists at `:869-913`; the **guard-throw** characterization (`ALREADY_PAUSED`/`NOT_PAUSED`) does **not** exist yet — add it.
- **Engine source:** `src/realtime/services/activity-engine.service.ts`
  - `resumeActivity` resets `state.isPaused = false;` at **`:622`** (note's `:573`/`:581` is stale — assert behavior, not line). This is the silent self-mutation under test.
  - `pauseActivity` guard `ALREADY_PAUSED` at `:508-509`; `unpauseActivity` guard `NOT_PAUSED` at `:549-550`. Both also reject root sessions with `NO_ACTIVE_SESSION`.
  - `getSession(userId, sessionId)` delegate exists at `:578-580` — the pinned surfacing mechanism for the controller.
- **Controller spec:** `src/realtime/module-state.grpc.controller.spec.ts`
  - `makeActivityEngine()` at `:28-45` mocks the **entire** engine. It has **no `getSession`** mock — this must be added.
  - Reconnect RESUMED case at `:153-176` already asserts `toHaveLength(1)` + `{ status: RESUMED, isPaused: false }` (note 37's len-1 revert already landed). This is the (a) resumed-**unpaused** case — keep it; add the (b) resumed-**paused** counterpart.
- **Controller source:** `src/realtime/module-state.grpc.controller.ts`
  - Reconnect emission block at `:168-180` hardcodes `isPaused: false` at **`:173`** and emits `activityType` at `:174` (must be preserved by note 24, irrelevant to these tests but do not touch).

## Tasks

### Phase 1: Engine-level pause-integrity tests (`activity-engine.service.spec.ts`)

- [x] **Task 1: Add pause/unpause guard characterization (GREEN, stay GREEN)**
  Files: `src/realtime/services/activity-engine.service.spec.ts`
  In the existing `ActivityEngine` describe, add a `describe('pause/unpause guards — characterization')` block. Seed a single child via `activitySessionStore.addChild('user-1', 'session-1', { sessionId: 'session-1', activityType: ActivityType.BREATH, rootSessionId: null, startedAt: now, lastActivityAt: now, isPaused: <seed> })` (mirror the existing marker-characterization seeds at `:869-913`). Assert:
  - `pauseActivity('user-1', 'session-1')` on an already-paused session (`isPaused: true`) **throws** with message `WsErrorCode.ALREADY_PAUSED` (use `expect(() => ...).toThrow(...)`).
  - `unpauseActivity('user-1', 'session-1')` on a non-paused session (`isPaused: false`) **throws** `WsErrorCode.NOT_PAUSED`.
  - (Optional, reinforcing) a happy `pauseActivity` on a non-paused child writes `isPaused = true`; a happy `unpauseActivity` on a paused child writes `isPaused = false`.
  Import `WsErrorCode` from `../constants/ws-error-codes` if not already imported. These are characterization — they must pass NOW and stay green after note 24. A red here after note 24 = regression → escalate, do not weaken.

- [x] **Task 2: Add resume-preserves-pause + unpause-succeeds target cases (RED until note 24)** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.spec.ts`
  Add a `describe('pause integrity across resume — RED until spec 24-pause-state-integrity')` block. Seed a **paused** child and mock the DB so `resumeActivity` reaches the reset line (mirror the resume happy-path at `:620-649`):
  - Seed `activitySessionStore.addChild('user-1', 'session-1', { sessionId: 'session-1', activityType: ActivityType.BREATH, rootSessionId: null, startedAt, lastActivityAt, isPaused: true })`.
  - `repo.findOne.mockResolvedValue(makeSession({ status: SessionStatus.DISCONNECTED }))`; `repo.save.mockImplementation((s) => Promise.resolve({ ...s }))`.
  - Case A — **resume preserves pause:** after `await engine.resumeActivity('user-1', 'session-1')`, assert `activitySessionStore.getSession('user-1', 'session-1')?.isPaused` is **`true`**. RED now (engine resets to `false` at `:622`) → GREEN after note 24.
  - Case B — **unpause succeeds after resume:** after the same `resumeActivity`, `expect(() => engine.unpauseActivity('user-1', 'session-1')).not.toThrow()` (it was still paused, so `NOT_PAUSED` must not fire). RED now → GREEN after note 24.
  Label the describe/it titles with `RED until spec 24-pause-state-integrity` (L3). Do NOT skip or weaken if still red after note 24 — escalate (L4).

### Phase 2: Controller reconnect-emission test (`module-state.grpc.controller.spec.ts`)

- [x] **Task 3: Add `getSession` mock + resumed-paused emission target; pair the existing resumed-unpaused case** (depends on Task 2)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  - In `makeActivityEngine()` (`:28-45`) add `getSession: jest.fn().mockReturnValue(undefined)`. This is load-bearing: note 24 makes the controller call `this.activityEngine.getSession(userId, result.id)?.isPaused ?? false` in the reconnect emission; without the mock that call throws `TypeError` once note 24 lands. The default `undefined` return yields `?? false`, so all existing reconnect cases stay green pre-note-24.
  - Keep the existing `:153-176` case as the **(a) resumed-unpaused** path: `handleReconnect` resolves a session, `getSession` returns `undefined` (default) → `sessionState` still `{ status: RESUMED, isPaused: false }`, `toHaveLength(1)`. Green now and after note 24. Add a clarifying comment that this is the unpaused branch.
  - Add a new **(b) resumed-paused** target case (RED until note 24): set `activityEngine.handleReconnect.mockResolvedValue(makeSession({ id: 'resumed-session' }))` AND `activityEngine.getSession.mockReturnValue({ isPaused: true } as any)`, drive `trackActivity`, `await flushMicrotasks()`, then assert the single emitted frame `values[0].sessionState` `toMatchObject({ status: ActivityStatus.RESUMED, isPaused: true })` and `toHaveLength(1)`. RED now (controller hardcodes `isPaused: false` at `:173`) → GREEN after note 24 reads the surfaced flag. Label the title `RED until spec 24-pause-state-integrity`.
  - Do NOT assert `isPaused` read off the bare `result`/`ModuleSession` entity — there is no such field (permanent `undefined` trap). Only assert the emitted `StateResponse.sessionState.isPaused`, surfaced via the mocked `getSession`.

### Phase 3: Validation

- [x] **Task 4: Verify the RED/GREEN split** (depends on Task 3)
  Files: (run only — no edits)
  Run the two spec files: `npx jest src/realtime/services/activity-engine.service.spec.ts src/realtime/module-state.grpc.controller.spec.ts`. Confirm:
  - TypeScript compiles (no missing-symbol / mock-shape errors).
  - **Characterization** cases (Task 1, existing resumed-unpaused, all unrelated cases) **PASS**.
  - **Target** cases (Task 2 Case A/B, Task 3 resumed-paused) **FAIL (RED)** — this is the expected committed state for a pre-feature TDD test; failing targets here are correct, not a defect. Verify each fails for the documented reason (pause reset to false / hardcoded `isPaused: false`), not a setup/typo error.
  If a target passes now, the test is too weak — its vantage does not observe the bug; fix the seed/assertion before finishing. If a characterization fails now, the seed is wrong — fix it.
