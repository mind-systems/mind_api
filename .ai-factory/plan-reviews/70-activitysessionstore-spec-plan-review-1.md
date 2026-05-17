# Plan Review: 70-activitysessionstore-spec

**Plan:** `.ai-factory/plans/70-activitysessionstore-spec.md`
**Target Spec:** `src/realtime/services/activity-session-store.service.spec.ts`
**SUT:** `src/realtime/services/activity-session-store.service.ts`
**Risk Level:** 🟡 Medium

## Context Gates

- **ARCHITECTURE.md** — present, no boundary violations (spec stays inside the realtime module, alongside sibling specs `rate-limiter.service.spec.ts`, `active-stream-registry.service.spec.ts`, etc.). PASS.
- **RULES.md** — present (forbids `!`, sensitive logging, etc.). No rule applies to this spec since it's a test file with no business logic. PASS.
- **ROADMAP.md** — present (not inspected for this test-only spec). Test coverage roadmap (`ROADMAP_TESTS.md`) exists; the plan reads like a slot in that tree. WARN: plan doesn't reference the roadmap task it satisfies, but that's a minor traceability issue, not a blocker.
- **skill-context** — `.ai-factory/skill-context/` does not exist for `mind_api`. No project-level overrides to apply.

## Codebase Alignment Verification

Verified against actual SUT (`activity-session-store.service.ts`):

- File path, class name, public API surface (`get`, `has`, `set`, `delete`, `size`, `startGraceTimer`, `cancelGraceTimer`, `hasPendingGraceTimer`) — ✅ match.
- `ActivityState` interface path (`../interfaces/activity-state.interface.ts`) — ✅ exists, shape: `{ sessionId, activityType, activityRefId?, startedAt, lastActivityAt, isPaused }`.
- `DEFAULT_GRACE_MS = 30_000` and `WS_RECONNECT_GRACE_MS` config key — ✅ match.
- `set()` and `delete()` semantics (state-only, do not touch `timers`) — ✅ Tasks 3 and 4 correctly reflect this.
- `startGraceTimer()` first calls `cancelGraceTimer(userId)`, then schedules — ✅ Task 7 correctly assumes replacement semantics.
- Post-expiry callback runs `this.timers.delete(userId); void onExpiry();` — ✅ Task 8 correctly asserts the timer entry is gone after firing.
- Established test style (`makeActivitySessionStore()` helper in `activity-engine.service.spec.ts`, `rate-limiter.service.spec.ts` pattern with `useFakeTimers` / `useRealTimers` in before/after) — ✅ plan is consistent.

## Critical Issues

### 1. Task 9 makes incorrect assumptions about error handling in `startGraceTimer`

The SUT body is:

```ts
const handle = setTimeout(() => {
  this.timers.delete(userId);
  void onExpiry();
}, this.graceMs);
```

`void` only discards the return value — it does **not** install a `.catch()` handler nor a `try/catch`. Therefore:

- A **synchronous throw** inside `onExpiry` will propagate out of the `setTimeout` callback and surface as an `uncaughtException` in Node.
- A **rejected Promise** returned by `onExpiry` is fire-and-forget and produces an `unhandledRejection`.

The plan's Task 9 asserts the opposite:
- *"should swallow synchronous errors thrown by onExpiry without producing an unhandled error"* — **will fail** against current code.
- *"should swallow rejected promises returned by onExpiry without producing an unhandled rejection"* — **will fail** against current code.

A test "plan" should describe what the SUT *does*, not what it ought to do. Two options to fix:

- **Option A (preferred for a pure spec task):** Reword Task 9 to characterize the actual behavior:
  - `should not throw inside setTimeout's tick when onExpiry returns a resolved Promise` (this is the only honest claim today)
  - `should fire onExpiry exactly once and remove the timer entry, even when onExpiry returns a Promise that is not awaited by the store` (covers the `void` semantics)
  - Drop the synchronous-throw and rejected-Promise "swallow" cases entirely, or
- **Option B:** Treat Task 9 as a spec that *drives* a small SUT fix (wrap the callback in `try { ... } catch { /* swallow or log */ }` and add `.catch(() => …)` for the Promise path). But this is outside a pure test-coverage plan — it should be promoted to a separate fix task and noted in ROADMAP.

Either way, the plan must not ship as-is with Task 9 making false claims about the SUT.

### 2. Task 9 sub-case "await/ignore a Promise-returning onExpiry" — microtask timing

> `should await/ignore a Promise-returning onExpiry callback without throwing (void-wrapped)`

Because `void onExpiry()` is not awaited, with `jest.useFakeTimers()` the Promise resolves on the microtask queue *after* `advanceTimersByTime` returns. The test must `await Promise.resolve()` (or `await flushMicrotasks()` / `jest.runAllTimersAsync()`) before asserting call counts, otherwise the assertion can race or under-count. Add an explicit note to the plan that any Promise-returning callback case must flush microtasks; otherwise the implementer will write flaky tests.

## Non-Critical Suggestions

### 3. Task 6: prefer `graceMs`-exact advance over `+1`

> `advance by 30001ms`

`setTimeout(fn, n)` fires at exactly `n` under Jest fake timers; the `+1` margin is harmless but slightly misleading. Either keep it (defensive) or switch to `jest.advanceTimersByTime(graceMs)`. Not a blocker — clarify in implementation, not in the plan.

### 4. Task 1: "should report size 0 and no pending timers when newly instantiated"

`hasPendingGraceTimer` requires a userId argument. Reword to: *"should return false from `hasPendingGraceTimer('any-user')` immediately after construction"*. Minor wording fix.

### 5. Task 5: missing case — `delete()` does **not** affect `size` of `timers`

The plan tracks `size` (state map) but never asserts the converse for the `timers` map. Suggest adding to Task 5 or Task 4 an explicit case: *"should not change the result of `hasPendingGraceTimer(otherUser)` when `delete(userA)` is called"* — paired with the existing Task 4 case for the same userId. Nice-to-have, not blocking.

### 6. Construction helper consistency

`activity-engine.service.spec.ts` already defines `makeActivitySessionStore()` with a stub `ConfigService`. The new spec should mirror that pattern (inline helper `makeConfig(value?)` returning `{ get: jest.fn().mockReturnValue(value) }`) so future readers see one idiom across the realtime test tree. Add this as an explicit note in the plan.

### 7. Test command

`npx jest src/realtime/services/activity-session-store.service.spec.ts` — ✅ matches local convention from `mind_api/CLAUDE.md`.

## Positive Notes

- Phase decomposition cleanly mirrors the public API surface; each phase is independently runnable.
- Map-semantics tests (Task 2–5) correctly distinguish state-map operations from timer-map operations — this is the subtle invariant of the SUT and the plan nails it.
- Concurrent-independence cases (Task 10) catch the most likely future regression (sharing a single timer handle instead of a `Map<string, Timeout>`).
- Plan correctly anticipates that `startGraceTimer` calls `cancelGraceTimer` internally and writes Task 7 to assert that.
- Post-expiry cleanup (Task 8) explicitly exercises the `timers.delete` happening *before* the user callback fires — this is exactly the right thing to lock down.

## Verdict

**Do not pass.** Task 9 makes assertions that contradict the SUT (`void` does not swallow errors). The implementer would either write green-by-accident tests (catching exceptions in user-land before they fire) or red tests they'd be tempted to "fix" by editing the SUT outside scope. Rewrite Task 9 along Option A above (and add the microtask-flushing note), apply the minor wording fixes (Tasks 1, 5), then this plan is ready.
