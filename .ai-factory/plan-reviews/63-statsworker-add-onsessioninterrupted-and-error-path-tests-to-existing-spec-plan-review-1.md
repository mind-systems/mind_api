# Plan Review: StatsWorker — add `onSessionInterrupted` and error-path tests

**Plan:** `.ai-factory/plans/63-statsworker-add-onsessioninterrupted-and-error-path-tests-to-existing-spec.md`
**Risk Level:** 🟢 Low

## Verification Against Source

Cross-checked plan claims against actual code:

- `src/stats/stats.worker.ts` — Confirmed three handlers (`onSessionCompleted`, `onSessionAbandoned`, `onSessionInterrupted`) decorated with `@OnEvent(SessionEvents.*)`. All three are structurally identical: they wrap `await this.statsService.finalise(event)` in a try/catch and call `this.logger.error('Stats finalise FAILED: userId=${event.userId} sessionId=${event.sessionId}', err)` on rejection. Swallowing behavior matches the plan's description (no rethrow).
- `src/stats/stats.worker.spec.ts` — Confirmed existing helpers `makeStatsService()` and `makeEvent()` plus the `beforeEach` block. Existing happy-path tests for completed/abandoned are present; interrupted is indeed missing.
- `SessionEvent` interface (in `stats.service.ts`) matches the shape produced by `makeEvent()`.

## Context Gates

- **ARCHITECTURE.md** — No conflict. This is a unit-test-only change in `src/stats/`.
- **RULES.md** — Not present / no conflict.
- **ROADMAP.md** — N/A (test-coverage task, no functional change).

## Plan-Level Checks

### Correctness
- The instruction to invoke `worker.onSessionInterrupted(event)` directly (bypassing `@OnEvent`) matches how the existing tests already work — consistent and correct.
- Logger spy approach `jest.spyOn(worker['logger'], 'error')` is valid: `logger` is a per-instance property initialized in the field declaration, so spying after `new StatsWorker(...)` (i.e. after `beforeEach`) works. Spy must be installed *before* invoking the handler — the plan correctly says "after instantiation" which in the existing `beforeEach`-based setup means inside the test body, before the `await worker.on...(event)` call. Consider stating this explicitly as "before invoking the handler" to remove any ambiguity, but the current wording is acceptable.
- Substring assertions for `event.userId` (`user-1`) and `event.sessionId` (`sess-1`) are sound — the production format `Stats finalise FAILED: userId=user-1 sessionId=sess-1` contains both as plain substrings.
- The plan's reminder that `finalise` rejection should not cause the handler promise to reject (`resolves.toBeUndefined()`) is exactly the right behavior to lock in, since the source swallows.

### Test Isolation
- `makeStatsService()` is invoked per-test via `beforeEach`, so overriding `statsService.finalise = jest.fn().mockRejectedValue(...)` inside an individual test does not leak — correct.
- Grouping error tests in a separate `describe('error path', ...)` block preserves the existing happy-path tests untouched, as the plan requires.

### Scope / Architecture
- No new modules, no DB changes, no migrations, no security concerns — purely unit-test additions.
- File path `src/stats/stats.worker.spec.ts` is correct.
- Test command `npx jest src/stats/stats.worker.spec.ts` matches the repo's Jest setup documented in `CLAUDE.md`.

### Minor Suggestions (non-blocking)
- For the error tests, consider also asserting `statsService.finalise` was called exactly once with the `event`, to prove the catch wraps the awaited call and the handler doesn't short-circuit before it. Not required — the plan's existing assertions are sufficient to fail correctly on regressions.
- Optionally silence the happy-path `this.logger.log(...)` calls in error tests with `jest.spyOn(worker['logger'], 'log').mockImplementation(() => undefined)` to keep test output clean. Cosmetic only.

## Positive Notes
- Plan reuses existing helpers instead of duplicating fixtures — keeps the spec DRY.
- Substring matching on `userId`/`sessionId` (rather than full-string equality) correctly avoids brittle assertions on log wording.
- Explicit guidance to avoid over-asserting the error identity (`expect.any(Error)` at most) is good defensive testing style.

PLAN_REVIEW_PASS
