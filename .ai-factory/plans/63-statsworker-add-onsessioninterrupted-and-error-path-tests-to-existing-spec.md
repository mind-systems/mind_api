# Test Plan: StatsWorker — add `onSessionInterrupted` and error-path tests to existing spec

## Context
`src/stats/stats.worker.ts` defines three identical event handlers (`onSessionCompleted`, `onSessionAbandoned`, `onSessionInterrupted`) that delegate to `statsService.finalise(event)` inside a try/catch and swallow errors via `logger.error`. The existing spec covers only the two happy paths for completed/abandoned; this plan adds the missing `onSessionInterrupted` happy path and the swallowed-error path for all three handlers.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/stats/stats.worker.spec.ts`

## Target Spec File
`src/stats/stats.worker.spec.ts`

## Tasks

### Phase 1: StatsWorker — extend existing spec

- [x] **Task 1: `onSessionInterrupted` happy path**
  Files: `src/stats/stats.worker.spec.ts`
  Test cases:
  - `should call finalise once with the event when session.interrupted is handled`
  Notes:
  - Reuse the existing `makeStatsService()` / `makeEvent()` helpers and the `beforeEach` setup.
  - Call `worker.onSessionInterrupted(event)` directly (do not rely on `@OnEvent`).
  - Assert `statsService.finalise` was called exactly once and with the same `event` reference.
  - Do not modify the existing `onSessionCompleted` / `onSessionAbandoned` tests.

- [x] **Task 2: error path is swallowed in all three handlers**
  Files: `src/stats/stats.worker.spec.ts`
  Test cases:
  - `should resolve (not throw) and log error with userId and sessionId when finalise rejects on session.completed`
  - `should resolve (not throw) and log error with userId and sessionId when finalise rejects on session.abandoned`
  - `should resolve (not throw) and log error with userId and sessionId when finalise rejects on session.interrupted`
  Notes:
  - Group these in a dedicated `describe('error path', ...)` block so the existing happy-path tests remain untouched.
  - For each test, override `statsService.finalise = jest.fn().mockRejectedValue(new Error('boom'))` before invoking the handler.
  - Spy on the private logger via `jest.spyOn(worker['logger'], 'error')` after instantiation.
  - Assertion 1: `await expect(worker.onSessionXxx(event)).resolves.toBeUndefined()` — the returned promise must resolve, not reject.
  - Assertion 2: the `error` spy was called, and the first argument (a string) contains both `event.userId` and `event.sessionId` (use `expect.stringContaining(event.userId)` + a second `expect.stringContaining(event.sessionId)` check, or a regex). The second argument is the thrown `Error` instance — do not over-assert its identity beyond `expect.any(Error)` if asserted at all.
  - Do not assert log-message wording beyond the required `userId` / `sessionId` substrings; the source uses `Stats finalise FAILED: userId=... sessionId=...`, so substring matching is sufficient.
