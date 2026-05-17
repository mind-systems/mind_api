# ActivitySessionStore — Test Plan

**Date:** 2026-05-17
**Source:** roadmap-test-coverage agent

## Source Overview

`ActivitySessionStore` is a lightweight in-memory store that manages active user activity sessions and grace-period timers for reconnection handling. It holds a map of `ActivityState` objects keyed by userId and coordinates reconnection grace windows via `setTimeout`. It serves as the ephemeral state layer for the real-time activity engine.

## Instantiation

```typescript
const configService = { get: jest.fn().mockReturnValue(undefined) };
const service = new ActivitySessionStore(configService as any);
```

Use `jest.useFakeTimers()` in `beforeEach` and `jest.useRealTimers()` in `afterEach` — the service uses `setTimeout`/`clearTimeout` directly.

Mock dependencies:
- `ConfigService.get('WS_RECONNECT_GRACE_MS')` — returns `number | undefined`
- Jest fake timers — required for all timer tests

## Existing Coverage

None.

## Test Cases

### Constructor

- should use default grace period (30000ms) when ConfigService returns undefined
- should use custom grace period from ConfigService (e.g., 10000ms)
- should initialize with empty map and no pending timers

### `get()` / `has()` / `set()` / `delete()`

- `get()` should return undefined for unknown userId
- `get()` should return stored ActivityState
- `has()` returns false for unknown userId, true after set, false after delete
- `set()` should store state and overwrite on second call (no duplicates)
- `set()` should not affect pending timers
- `delete()` returns true when state existed, false when it did not
- `delete()` does NOT auto-cancel grace timer (timers are independent of state)
- `size` returns 0 initially, increases with set, decreases with delete, unchanged when overwriting same userId

### `startGraceTimer()`

- should call `onExpiry` callback after grace period expires
  - Setup: `jest.useFakeTimers()`, pass `jest.fn()` as callback, advance by graceMs+1
- should cancel the previous timer when called twice for the same userId
  - Setup: Call with cb1, advance 15s, call with cb2, advance 30s more — cb1 must never fire
- should remove timer from timers map after expiry (hasPendingGraceTimer → false)
- should handle async onExpiry callback (void-wrapped, errors swallowed)
- should handle onExpiry that throws — error swallowed, no unhandled rejection
- should allow concurrent timers for different userIds
- should allow new timer after expiry of previous timer for same userId
- should use custom grace period from constructor

### `cancelGraceTimer()`

- should cancel pending timer and remove it from timers map
- should be a no-op (no error) when no timer is pending for userId
- should not affect activity state when canceling timer
- should allow new timer to be started after cancel

### `hasPendingGraceTimer()`

- returns false when no timer is pending
- returns true immediately after startGraceTimer
- returns false after timer expires
- returns false after timer is cancelled
- distinguishes between different userIds

### Integration

- full lifecycle: set → startTimer → cancel → state persists, timer gone
- full lifecycle: set → startTimer → expiry → callback calls delete → state gone
- rapid fire: set/delete/set/startTimer — no race condition

## Gotchas

1. **Must use `jest.useFakeTimers()`** — without fake timers, tests hang or race.
2. **`onExpiry` is void-wrapped** — exceptions/rejections are swallowed; verify via jest.fn() spy, not side effects.
3. **`startGraceTimer()` auto-cancels previous timer** — implicit `cancelGraceTimer()` on each call for same userId.
4. **Timer cleanup is internal** — `timers.delete(userId)` happens before callback; test via `hasPendingGraceTimer()`.
5. **Private members are inaccessible** — test only via public API: `get/has/set/delete/size/hasPendingGraceTimer`.
6. **Advance `graceMs + 1`** — advancing exactly `graceMs` may or may not fire depending on timing semantics.
