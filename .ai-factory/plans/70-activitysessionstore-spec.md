# Test Plan: ActivitySessionStore spec

## Context
`ActivitySessionStore` (`src/realtime/services/activity-session-store.service.ts`) is an in-memory store that wraps a `Map<string, ActivityState>` and a parallel `Map<string, Timeout>` of grace-period reconnection timers. The grace duration is sourced from `ConfigService.get('WS_RECONNECT_GRACE_MS')` with a 30 000 ms fallback. This spec exercises the full public API using Jest fake timers, asserting Map semantics, timer lifecycle, and isolation between concurrent userIds.

Tracked under the realtime test-coverage roadmap (`ROADMAP_TESTS.md`).

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/realtime/services/activity-session-store.service.spec.ts`

## Target Spec File
`src/realtime/services/activity-session-store.service.spec.ts`

## Implementation Notes (apply to every task below)

- **Test setup style:** mirror the sibling realtime specs (`activity-engine.service.spec.ts`, `rate-limiter.service.spec.ts`). Define an inline `makeActivitySessionStore(graceMs?)` helper that constructs a `ConfigService` stub (e.g. `{ get: jest.fn().mockReturnValue(graceMs) }`) and returns a fresh `ActivitySessionStore`. Use `jest.useFakeTimers()` in `beforeEach` and `jest.useRealTimers()` in `afterEach`.
- **Microtask flushing:** the SUT calls `void onExpiry()` inside `setTimeout`. When `onExpiry` returns a Promise, the resolution happens on the microtask queue, *after* `jest.advanceTimersByTime(...)` returns. Any test that uses a Promise-returning callback must explicitly flush microtasks — either `await Promise.resolve()`, `await jest.runAllTicks()`, or use `jest.advanceTimersByTimeAsync(...)` / `jest.runAllTimersAsync()` — before asserting call counts. Without this the assertions race and under-count.
- **SUT honesty:** the plan describes what the SUT *does today*, not what it ideally should do. In particular, `void onExpiry()` only discards the return value; it does **not** install a `try/catch` or `.catch()`. Do not write tests that assert error-swallowing behavior — those would contradict the implementation. If error-handling is desired, that's a separate SUT fix outside this spec's scope.

## Tasks

### Phase 1: ActivitySessionStore — construction & grace configuration

- [x] **Task 1: constructor**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Test cases:
  - `should use the default grace period of 30000ms when ConfigService.get returns undefined`
  - `should use the custom grace period from ConfigService when WS_RECONNECT_GRACE_MS is set`
  - `should query ConfigService with the key "WS_RECONNECT_GRACE_MS"`
  - `should return 0 from size immediately after construction`
  - `should return false from hasPendingGraceTimer('any-user') immediately after construction`

### Phase 2: ActivitySessionStore — Map API (get / has / set / delete / size)

- [x] **Task 2: get() and has()**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Test cases:
  - `should return undefined from get() when the userId is unknown`
  - `should return false from has() when the userId is unknown`
  - `should return the stored ActivityState from get() after set()`
  - `should return true from has() after set() for the same userId`

- [x] **Task 3: set()**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Test cases:
  - `should store the state and make it retrievable via get() when set() is called for a new userId`
  - `should overwrite the previous state when set() is called twice for the same userId`
  - `should not start, cancel, or otherwise affect a pending grace timer when set() is called`

- [x] **Task 4: delete()**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Test cases:
  - `should return true and remove the state from get()/has() when delete() is called for an existing userId`
  - `should return false when delete() is called for an unknown userId`
  - `should not cancel a pending grace timer when delete() is called (timers are independent of state)`
  - `should leave hasPendingGraceTimer(otherUser) unchanged when delete(userA) is called`

- [x] **Task 5: size getter**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Test cases:
  - `should return 0 when no states are stored`
  - `should increment by 1 after each set() for a new userId`
  - `should remain unchanged when set() overwrites an existing userId`
  - `should decrement by 1 after delete() removes an existing userId`
  - `should remain unchanged after delete() for an unknown userId`

### Phase 3: ActivitySessionStore — startGraceTimer()

- [x] **Task 6: startGraceTimer() — happy path firing**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Test cases:
  - `should invoke the onExpiry callback exactly once after the default grace period elapses (advance by graceMs)`
  - `should invoke the onExpiry callback after the custom grace period when ConfigService returned a custom value`
  - `should not invoke the onExpiry callback before the grace period elapses (advance by graceMs - 1)`

- [x] **Task 7: startGraceTimer() — replacing an existing timer for the same userId**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Test cases:
  - `should cancel the previous timer so its callback never fires when startGraceTimer() is called twice for the same userId`
  - `should fire only the most recent callback after graceMs elapses from the second startGraceTimer() call`

- [x] **Task 8: startGraceTimer() — post-expiry cleanup**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Test cases:
  - `should remove the timer from the internal map after expiry so hasPendingGraceTimer() returns false`
  - `should allow a new grace timer to be started for the same userId after the previous one expired`

- [x] **Task 9: startGraceTimer() — Promise-returning callback (void semantics)**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Notes: The SUT invokes the callback as `void onExpiry()` — the returned Promise is intentionally not awaited. These cases lock down that semantic. Each Promise case must flush microtasks (see the global Implementation Notes) before asserting.
  Test cases:
  - `should invoke onExpiry exactly once and remove the timer entry when onExpiry returns a resolved Promise (after flushing microtasks)`
  - `should not block subsequent timer scheduling for the same userId on the un-awaited Promise returned by onExpiry`

- [x] **Task 10: startGraceTimer() — concurrent independence between userIds**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Test cases:
  - `should fire each userId's callback independently when concurrent timers are started for different userIds`
  - `should leave userB's pending timer intact when userA's timer expires`
  - `should leave userB's pending timer intact when userA's timer is cancelled via cancelGraceTimer()`

### Phase 4: ActivitySessionStore — cancelGraceTimer()

- [x] **Task 11: cancelGraceTimer()**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Test cases:
  - `should prevent the pending callback from firing when cancelGraceTimer() is called before graceMs elapses`
  - `should remove the timer entry so hasPendingGraceTimer() returns false after cancelGraceTimer()`
  - `should be a no-op (no throw) when cancelGraceTimer() is called for a userId with no pending timer`
  - `should not modify the stored ActivityState when cancelGraceTimer() is called`
  - `should allow a new grace timer to be started for the same userId after cancelGraceTimer()`

### Phase 5: ActivitySessionStore — hasPendingGraceTimer()

- [x] **Task 12: hasPendingGraceTimer()**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Test cases:
  - `should return false when no timer has been started for the userId`
  - `should return true immediately after startGraceTimer() is called`
  - `should return false after the grace period elapses and the timer fires`
  - `should return false after cancelGraceTimer() is called`
  - `should distinguish between different userIds (true for one, false for another)`
