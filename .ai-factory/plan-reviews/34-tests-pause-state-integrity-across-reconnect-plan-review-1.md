# Plan Review — Tests: pause-state integrity across reconnect

**Plan:** `.ai-factory/plans/34-tests-pause-state-integrity-across-reconnect.md`
**Spec:** `.ai-factory/notes/28-test-pause-state-integrity.md` (feature: `notes/24-pause-state-integrity.md`)
**Risk Level:** 🟢 Low — test-only, no production code, no migrations.

## Verdict

The plan is accurate against the current codebase, internally consistent, and faithfully
implements the TDD contract in note 28. Every anchor, line reference, symbol, and API call
was verified against source. No blocking issues found.

## Verification performed (all confirmed against source)

| Claim in plan | Verified |
|---|---|
| `resumeActivity` resets `state.isPaused = false` | ✅ `activity-engine.service.ts:622` (note's `:573`/`:581` correctly flagged stale) |
| `pauseActivity` guard `ALREADY_PAUSED`, `unpauseActivity` guard `NOT_PAUSED` | ✅ `:508-509`, `:549-550` |
| `getSession(userId, sessionId)` engine delegate exists | ✅ `:578-580`, delegates to store `:108-113` |
| Controller hardcodes `isPaused: false` on reconnect emission | ✅ `module-state.grpc.controller.ts:173` |
| Reconnect RESUMED case asserts `toHaveLength(1)` + `{ status: RESUMED, isPaused: false }` | ✅ spec `:169-173` |
| `makeActivityEngine()` mocks the whole engine and has **no** `getSession` | ✅ spec `:28-45` |
| Guard-throw characterization does **not** yet exist; marker characterization does | ✅ markers at `:869-913`; no `ALREADY_PAUSED`/`NOT_PAUSED` throw test present |
| Store API: `addChild`, `getSession`, `setRoot` exist and behave as used | ✅ `activity-session-store.service.ts:92-113` |
| `WsErrorCode.ALREADY_PAUSED` / `NOT_PAUSED` exist | ✅ `constants/ws-error-codes.ts:8-9` |
| `WsErrorCode` not yet imported in engine spec | ✅ correct — plan instructs the import |
| Proto `StateResponse.sessionState.isPaused` field exists | ✅ controller writes it `:173/:537`; existing passing test asserts it |

## RED/GREEN soundness (two-state observability)

- **Task 2 Case A** — vantage `store.getSession('user-1','session-1')?.isPaused` over a **real**
  store. The engine mutates the same `ActivityState` reference seeded via `addChild`, so the
  vantage observes `false` now (RED) and `true` after the `:622` reset is removed (GREEN). Sound.
- **Task 2 Case B** — `unpauseActivity(...).not.toThrow()`. Pre-note-24 `isPaused` is reset to
  `false` → `NOT_PAUSED` fires → RED. Post-note-24 it stays `true` → succeeds → GREEN. Sound. No
  root is seeded, `getRootId` is `null`, `activityType=BREATH`, so the `NO_ACTIVE_SESSION` guards
  are not tripped — the test fails for exactly the documented reason.
- **Task 3 resumed-paused** — the hardcoded `isPaused: false` at `:173` produces a frame whose
  **only** failing assertion is `isPaused`; `toHaveLength(1)` passes (reconnect emits one frame;
  `ensureRoot` emits none). `result.activityType` is `undefined` and `mapInternalActivityType`
  returns the safe `ACTIVITY_TYPE_UNSPECIFIED` sentinel rather than throwing, so the frame is
  emitted cleanly. Clean single-reason RED → GREEN. Sound.
- The `getSession: jest.fn().mockReturnValue(undefined)` default keeps all existing reconnect
  cases green both before and after note 24 (`undefined ?? false`). Correct.

## Spec alignment (note 28)

- Anti-target handling matches the note exactly: **INVERT** the `(a)` RESUMED case into
  (a) resumed-unpaused (keep) + (b) resumed-paused (add) — not delete. ✅
- L1 outcomes-only, L3 `RED until spec 24-pause-state-integrity` labels, L4 escalation language all
  carried through. ✅
- The plan correctly refuses to assert `isPaused` off the bare `ModuleSession` entity (the
  permanent-`undefined` trap) and routes the controller assertion through the mocked `getSession`. ✅
- The engine `resumeActivity` describe block fixture seeds (`isPaused: false`) are left untouched,
  honoring the note's "these are seeds, not assertions — do not fix" warning. ✅

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** WARN — none. Test-only change within the `realtime`
  module; no module-boundary or dependency-direction impact. The plan respects the documented
  constraint that the controller has no `ActivitySessionStore` dependency (it surfaces pause
  through `ActivityEngine`).
- **Rules (`RULES.md`):** WARN (non-blocking) — RULES.md forbids the non-null assertion operator
  (`!`). The plan's own snippets use optional chaining (`?.isPaused`), which is compliant. The
  surrounding spec files already use `!` heavily in fixtures; new test code should keep to the
  `?.` style the plan already uses and avoid introducing fresh `!`. Not a plan defect — advisory
  for the implementer.
- **Roadmap (`ROADMAP.md`):** PASS — task is already linked at `ROADMAP.md:114` (Realtime
  durability epic / test tasks) and guards feature `ROADMAP.md:137` via note 24. Linkage present.

## Non-blocking considerations (for the note-24 implementer, not this plan)

1. **Surfacing-mechanism coupling (WARN).** Note 28 leaves the controller surfacing mechanism as
   an open choice between (i) `handleReconnect` returning the live flag and (ii) the controller
   calling `activityEngine.getSession(result.id)?.isPaused`. This plan deliberately **pins option
   (ii)** (Task 3 mock + reconnaissance anchor `:578-580`). That is a valid TDD pin — the test
   defines the contract note 24 must honor. The only risk is a coordination one: if note 24 is
   authored to surface the flag via the return value instead, the Task 3 case will stay RED after
   note 24 and read as a false escalation. Mitigation is already on-plan: note 24 must adopt the
   `getSession`-based surfacing. Worth an explicit cross-reference in note 24 so the implementer
   does not pick the other branch. No change required to this plan.

2. The optional reinforcing happy-path assertions in Task 1 (a non-paused pause writes `true`, a
   paused unpause writes `false`) are genuinely characterization and safe to include.

## Positive Notes

- Line-number staleness is handled correctly throughout: the plan asserts *behavior, not line*,
  and explicitly flags the note's `:573`/`:581`/`:142` references as stale against the real
  `:622`/`:173`.
- The validation task (Task 4) names the expected RED/GREEN split per case and the specific reason
  each target must fail for — preventing a setup/typo error from masquerading as a correct RED.
- Dependency ordering (Task 1 → 2 → 3 → 4) is correct and the file scoping is precise.

PLAN_REVIEW_PASS
