# SyncStreamService — Test Plan

**Date:** 2026-05-17
**Source:** roadmap-test-coverage agent

## Source Overview

`SyncStreamService` is a pub-sub router for real-time sync change events. Users register one or more push callbacks; when the `CHANGE_EVENT_LOGGED` event fires, the service debounces (300ms) and delivers batched events to all registered callbacks for the relevant userId. On module destroy, all pending timers are cleared.

## Instantiation

No constructor dependencies:

```typescript
const service = new SyncStreamService();
```

Use `jest.useFakeTimers()` for all timer-related tests. Call `onChangeLogged()` directly — do not try to trigger it via NestJS EventEmitter in unit tests.

## Existing Coverage

None.

## Test Cases

### `register()`

- should create a new entry for userId when first callback registered
- should add second callback to same userId without replacing the first
- should be idempotent if same callback reference registered twice (Set deduplication)
- should support multiple callbacks per userId

### `deregister()`

- should be a no-op when userId not in streams — no error
- should remove callback from callbacks Set
- should NOT delete user entry if other callbacks remain
- should clear pending timer and delete user entry when last callback removed
  - Gotcha: `clearTimeout` must be called on the pending timer
- should be a no-op when callback not in the Set for that userId

### `onChangeLogged()` — debounce logic

- should be a no-op when userId not registered
- should create pending timer on first event
  - Setup: `jest.useFakeTimers()`; verify callback fires after 300ms
- should append event to existing pending batch (not create new timer)
- should debounce: multiple events within 300ms → single flush with all events
- should extract `{ id, entity, refId, action }` fields from payload (not `userId`)

### flush behavior (via timer expiry)

- should clear `entry.pending` before calling callbacks (re-entrancy safety)
- should invoke all callbacks with the accumulated events array
- should fan-out to all N callbacks for a userId
- should deliver events only to the correct userId (not to others)
- should deliver events in arrival order (FIFO)

### Integration flows

- register → event → 300ms → callback receives event
- register → event → deregister before 300ms → callback NOT called, timer cleared
- two callbacks → event → deregister one → remaining callback receives event
- register → event → deregister → register new callback → second event → only second callback fires

### `onModuleDestroy()`

- should clear all pending timers across all userIds
- should delete all entries (streams Map empty after)
- should be safe on empty registry
- should be safe to call twice

## Gotchas

1. **Must use `jest.useFakeTimers()`** — real timers make tests take 300ms each and may race.
2. **Call `onChangeLogged()` directly** — `@OnEvent` decorator is NestJS magic, skipped in unit tests.
3. **`for...of` in flush stops on first throwing callback** — if cb1 throws, cb2 is never called. Test current behavior to document it.
4. **`pending = null` set before callbacks** — re-entrant calls to `onChangeLogged()` inside a callback create a new pending batch, not a second flush of the current one.
5. **Set reference semantics** — `deregister` uses `Set.delete()` which requires the same function reference. Pass the same function reference that was registered.
6. **Timer cleanup on last callback removal** — both `clearTimeout` and `streams.delete(userId)` must happen together; partial cleanup causes timer leaks.
