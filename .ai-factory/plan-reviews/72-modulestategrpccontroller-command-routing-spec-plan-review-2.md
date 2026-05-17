# Plan Review: ModuleStateGrpcController — command routing spec (Iteration 2)

**Plan file:** `.ai-factory/plans/72-modulestategrpccontroller-command-routing-spec.md`
**Target spec:** `src/realtime/module-state.grpc.controller.spec.ts`
**Risk Level:** 🟢 Low — all critical issues from Review 1 are addressed.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)**: PASS. Test-only milestone; no module-boundary, dependency-graph, or proto-ownership implications.
- **Rules (`.ai-factory/RULES.md`)**: PASS. Rules target production code (no non-null assertion, no PII in logs, `@Payload()` decorator). None constrain this spec file.
- **Roadmap (`.ai-factory/ROADMAP.md`)**: Plan title aligns with milestone-72 numbering already in the plans directory; no ROADMAP linkage block required for a test-coverage task.

## Review-1 Critical Issues — Resolution Check

### ✓ Critical Issue 1 (`makeSession` vs `ActivityState` shape)
The plan now contains an explicit "Mock shapes — `ModuleSession` vs `ActivityState`" subsection in `Notes for the implementer`:
- Enumerates the four engine methods that return `ModuleSession` and the controller reads `.id` (`handleReconnect`, `startActivity`, `endActivity`, `stopActivity`) — verified against `module-state.grpc.controller.ts` lines 88, 246, 261, 276.
- Enumerates the three engine methods that return `ActivityState` and the controller reads `.sessionId` (`getActiveSession` line 219, `pauseActivity` line 288, `unpauseActivity` line 310) — verified.
- Provides a concrete `makeActivityState({ sessionId, isPaused })` helper template and tells the implementer to define it inside the new routing `describe` block.
- The relevant test case bullets in Tasks 1, 4, 5 each carry an inline reminder ("mock `getActiveSession` with `makeActivityState({ sessionId: 'session-1' })`, not `makeSession()`"). Redundancy is intentional and appropriate for a checklist-driven implementer.

### ✓ Critical Issue 2 (empty-command "no engine method called" scoping)
Task 6 bullet now reads: *"should not call any of the routing-dispatched activityEngine methods (startActivity, endActivity, stopActivity, pauseActivity, unpauseActivity) when StateRequest is empty — scope the assertion to those five methods only. activityEngine.handleReconnect is already called once during setupConnectedStream and an unqualified ‘no engine method called’ assertion would fail; if a broader assertion is preferred, call jest.clearAllMocks() (or per-method mockClear()) immediately after the setup helper resolves and before request$.next({})."*

Both the why and the two acceptable mitigations are spelled out.

## Review-1 Non-blocking Notes — Resolution Check

- **A. Rate-limit override** — Addressed: explicit `rateLimiterService.consume.mockReturnValueOnce(false)` note added.
- **B. Empty `StateRequest` literal type-safety** — Addressed: plan notes `request$.next({})` is type-safe, no cast needed.
- **C. INTERNAL_ERROR scope (inner vs outer catch)** — Addressed: explicit paragraph stating the outer `.catch` on `routeCommand(...)` is unreachable from a mocked-engine-throw and intentionally out of scope.
- **D. `'isPaused' in sessionState` assertion strategy** — Preserved; correct.
- **F. Helper placement** — Addressed with the parenthetical "the routing `describe` must sit **inside** the outer `describe('ModuleStateGrpcController')`, not outside it" and "define it inside the new routing `describe` block, not at file scope".

## Verification Against Source

I re-read `module-state.grpc.controller.ts` and the generated proto. Concrete branch/test-case mapping:

| Controller branch | Test phase | Status |
|---|---|---|
| `activityStart` → rate-limit gate (l. 199–213) | Task 1 | covered |
| `activityStart` → existing session (l. 215–224) | Task 1 | covered, `existing.sessionId` field correctly addressed |
| `activityStart` → invalid type (l. 226–238) | Task 1 | covered |
| `activityStart` → happy path (l. 240–251) | Task 1 | covered, asserts `{ activityType: BREATH, activityRefId: cmd.refId }` |
| `activityEnd` happy / null (l. 253–266) | Task 2 | covered |
| `activityStop` happy / null (l. 268–281) | Task 3 | covered |
| `activityPause` happy / catch (l. 283–303) | Task 4 | covered; reads `err.message` as `code` — plan correctly uses lowercase `'no_active_session'` / `'already_paused'` |
| `activityResume` happy / catch (l. 305–325) | Task 5 | covered; lowercase `'no_active_session'` / `'not_paused'` |
| Empty-command fallthrough (l. 173–181) | Task 6 | covered |
| Inner-catch INTERNAL_ERROR (l. 182–191) | Task 6 | covered; via `endActivity` rejection — confirmed this triggers the inner `try/catch`, not the outer `.catch` on `setup()` line 100 |

`ActivityType.ACTIVITY_TYPE_UNSPECIFIED = 0` and `ActivityType.BREATH = 1` confirmed in `proto/generated/module_state.ts:21–24`. The plan instructs `ActivityType` to be imported from `../../proto/generated/module_state` — note that the current spec file only imports `ActivityStatus, StateRequest, StateResponse`. The implementer must add `ActivityType` to the import line. This is implicit but not stated as a step — minor heads-up, not blocking.

`StateRequest` fields confirmed all-optional (lines 89–95 of generated proto), so `request$.next({})` is type-safe as the plan claims.

## Other Notes (non-blocking)

### A. `ActivityType` import not currently present
The spec file's import at line 5 imports only `ActivityStatus, StateRequest, StateResponse`. Tasks 1 and 6 require `ActivityType` (for `ACTIVITY_TYPE_UNSPECIFIED` and `BREATH`). Worth a one-liner in Notes — but the named test cases make the requirement obvious in context, so this won't trip a careful implementer.

### B. `'isPaused' in values[i].sessionState` and optional chaining
`StateResponse.sessionState` is `StateEvent | undefined`. A strict-mode `in` operator on a possibly-undefined value will error. The implementer will need `'isPaused' in (values[i].sessionState ?? {})` or a preceding non-null check (RULES.md forbids `!` in production code; tests aren't strictly bound, but the cleaner form is trivial). Worth a one-line clarification, not blocking.

### C. Default mocks for synchronous methods
`pauseActivity` / `unpauseActivity` are `jest.fn()` with no return value — they return `undefined` by default. The controller reads `state.sessionId` immediately. Every success-path test in Tasks 4/5 must therefore override the mock; the plan already directs `makeActivityState(...)` for success paths and `mockImplementation(() => { throw new Error(...) })` (or equivalent) for error paths. The current `Notes for the implementer` text covers this — no change needed.

## Positive Notes

- Every Review-1 critical issue and non-blocking note has a corresponding plan update; Review 2 had nothing structural left to challenge.
- 1:1 mapping between `routeCommand` branches and test phases — easy to audit against the controller source.
- Inline reminders on the most error-prone test cases (e.g. "use `makeActivityState`, not `makeSession`") repeat the rule at point-of-use — implementer-friendly.
- The "stream stays open after INTERNAL_ERROR" pair of assertions (`sub.closed === false` + no complete/error fired) is the right behavioral proof.
- Phase boundaries remain independent and shippable phase-by-phase.

## Verdict

All Review-1 blockers resolved. Minor heads-ups about adding `ActivityType` to the import line and handling `sessionState` optionality in the `'isPaused' in ...` check are friendly-to-add but do not block implementation — both are obvious once the implementer types the test out.

PLAN_REVIEW_PASS
