# Plan Review: 70-activitysessionstore-spec (v2)

**Plan:** `.ai-factory/plans/70-activitysessionstore-spec.md`
**Target Spec:** `src/realtime/services/activity-session-store.service.spec.ts`
**SUT:** `src/realtime/services/activity-session-store.service.ts`
**Risk Level:** 🟢 Low

## Context Gates

- **ARCHITECTURE.md** — present. Spec sits inside the realtime module alongside the existing sibling specs (`activity-engine.service.spec.ts`, `rate-limiter.service.spec.ts`, `active-stream-registry.service.spec.ts`). No boundary violations. PASS.
- **RULES.md** — present. Rules cover `!` operator, sensitive logging, lean logs, gRPC `@Payload()` decorator usage. None apply to a pure unit spec for an in-memory store. PASS.
- **ROADMAP.md / ROADMAP_TESTS.md** — present; plan notes "Tracked under the realtime test-coverage roadmap (`ROADMAP_TESTS.md`)". WARN (non-blocking): plan does not name the specific roadmap entry, but the linkage is acknowledged.
- **skill-context** — `.ai-factory/skill-context/` not present for `mind_api`. No project-level overrides.

## Codebase Alignment Verification

Re-checked against the SUT and supporting interfaces:

- File path, class, public surface (`get`, `has`, `set`, `delete`, `size`, `startGraceTimer`, `cancelGraceTimer`, `hasPendingGraceTimer`) — match.
- `DEFAULT_GRACE_MS = 30_000`, config key `WS_RECONNECT_GRACE_MS`, nullish-coalescing fallback — match Task 1 cases.
- `ActivityState` shape (`sessionId`, `activityType`, `activityRefId?`, `startedAt`, `lastActivityAt`, `isPaused`) at `../interfaces/activity-state.interface.ts` — match.
- `set()` and `delete()` touch only `activityMap`; `timers` is independent — Tasks 3 & 4 cases hold.
- `startGraceTimer()` calls `cancelGraceTimer(userId)` first, then schedules — Task 7 cases hold.
- Timer callback: `this.timers.delete(userId); void onExpiry();` — Task 8 (post-expiry cleanup) and Task 9 (void semantics, no error swallowing claimed) match the implementation.
- `cancelGraceTimer()` is a guarded no-op when no handle exists — Task 11's no-throw case is correct.
- `makeActivitySessionStore()` helper pattern already exists in `activity-engine.service.spec.ts` (line 26) — the plan's instruction to mirror it is accurate.
- Test command matches `mind_api/CLAUDE.md` convention (`npx jest <path>`).

## Resolution of v1 findings

All blocking items from review 1 are addressed:

- **Task 9 honesty fix (v1 §1):** rewritten. The plan now explicitly states under "Implementation Notes / SUT honesty" that `void onExpiry()` does not install `try/catch` or `.catch()`, and explicitly forbids tests that assert error-swallowing. Task 9 sub-cases now lock down only the `void` semantics (exactly-once invocation, timer-entry removal, non-blocking of subsequent scheduling). ✅
- **Microtask flushing (v1 §2):** addressed globally in the "Implementation Notes" preamble, with three approved strategies (`await Promise.resolve()`, `jest.runAllTicks()`, `jest.advanceTimersByTimeAsync` / `jest.runAllTimersAsync`). Task 9's note re-references this requirement. ✅
- **Task 1 wording (v1 §4):** now reads "should return false from `hasPendingGraceTimer('any-user')` immediately after construction". ✅
- **Task 4 cross-user timer invariant (v1 §5):** added — "should leave `hasPendingGraceTimer(otherUser)` unchanged when `delete(userA)` is called". ✅
- **Construction helper consistency (v1 §6):** "Test setup style" note instructs mirroring sibling specs, including the inline `makeActivitySessionStore(graceMs?)` helper and `ConfigService` stub. ✅

## Critical Issues

None.

## Non-Critical Suggestions

### 1. Task 6 — exact-boundary advance vs. `+1`
The v1 review flagged `+1` margins as harmless but slightly misleading. The plan already lands on the cleaner phrasing ("advance by `graceMs`" and "advance by `graceMs - 1`"). No action — noted only because the implementer should keep this phrasing literally (use `jest.advanceTimersByTime(graceMs)` for the firing case, not `graceMs + 1`).

### 2. Task 9 — make the "Promise that is not awaited" case explicit about ordering
The current wording is fine, but implementers can still get tripped up: the assertion must be that `onExpiry` is *called* once (call-count on a `jest.fn()`), not that its returned Promise *resolves* before the next assertion. A one-line clarification ("assert `mock.calls.length === 1` after microtask flush; do not await `mock.results[0].value`") would prevent a flaky write. Optional polish, not a blocker.

### 3. Task 7 — consider asserting on the original callback's mock
Currently phrased as "the previous timer's callback never fires". Worth noting in implementation that this is best proven by passing two distinct `jest.fn()` mocks (`firstCb`, `secondCb`) and asserting `firstCb` has 0 calls and `secondCb` has 1 call after `graceMs` elapses from the second call. The plan permits this implicitly but doesn't spell it out.

### 4. Task 10 — independence from `cancelGraceTimer`
The third case ("should leave userB's pending timer intact when userA's timer is cancelled via `cancelGraceTimer()`") is the strongest regression guard against a future refactor that consolidates timers. Good catch. No action.

## Positive Notes

- The "Implementation Notes (apply to every task below)" preamble is a meaningful upgrade over v1 — three sharp paragraphs (test setup, microtask flushing, SUT honesty) that the implementer cannot miss. This is the right place for cross-cutting guidance.
- Phase decomposition mirrors the public API surface cleanly; each phase is independently runnable and the test-case names already double as documentation.
- The Map-semantics phase (Tasks 2–5) correctly separates the `activityMap` (state) from the `timers` map (lifecycle). This is the subtle invariant of this SUT and the plan locks it down on both sides.
- Concurrent-independence (Task 10) catches the most likely future regression (e.g., refactoring to a single timer handle instead of `Map<string, Timeout>`).
- Post-expiry cleanup (Task 8) explicitly asserts the ordering: `timers.delete` happens before `onExpiry()`, which matches the SUT and prevents accidental reordering.

## Verdict

The v1 blockers are all resolved. Remaining notes are polish for the implementer, not gates on the plan.

PLAN_REVIEW_PASS
