# Test Plan: SyncStreamService spec

## Context
`SyncStreamService` (`src/realtime/services/sync-stream.service.ts`) is a pub-sub router that registers push callbacks per `userId`, debounces incoming `CHANGE_EVENT_LOGGED` payloads for 300ms, and fans the batched `LiveEvent[]` out to every callback registered for that user. No spec exists today — this milestone creates one covering registration, debounce, fan-out, teardown, and the documented `for...of` error behavior.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/realtime/services/sync-stream.service.spec.ts`

## Target Spec File
`src/realtime/services/sync-stream.service.spec.ts`

## Test Harness (applies to every phase)

- **Fake timers are mandatory.** Use `jest.useFakeTimers()` in `beforeEach` and `jest.useRealTimers()` in `afterEach`. Advance the debounce window with `jest.advanceTimersByTime(300)` (or `jest.advanceTimersByTimeAsync(300)` if a callback returns a promise). This matches the pattern in `rate-limiter.service.spec.ts` and `stream-engine.service.spec.ts` and is required for Phase 3, 4, and 5 assertions to work — under real timers the `setTimeout` callback in `flush()` runs on the event loop and a throw becomes an `uncaughtException` instead of a synchronous error.
- **Direct instantiation.** `SyncStreamService` has no constructor dependencies — instantiate via `new SyncStreamService()` in `beforeEach` (same pattern as `active-stream-registry.service.spec.ts`). Do not bring up a Nest testing module.
- **Invoke `onChangeLogged` directly.** The `@OnEvent('CHANGE_EVENT_LOGGED')` decorator is metadata wired by `EventEmitter2` at the `AppModule` level; specs call `service.onChangeLogged(payload)` directly. Do not stand up an `EventEmitter2` instance.
- **No reaching into private state.** `streams` is `private`. All assertions go through public behavior (callback invocation, no-op on re-trigger). Do not use `(service as any).streams` to inspect size or contents.

## Tasks

### Phase 1: register() — registration semantics

- [ ] **Task 1: `register()` behavior**
  Files: `src/realtime/services/sync-stream.service.spec.ts`
  Test cases:
  - `should create a new entry for a userId when the first callback is registered`
  - `should add a second callback to the same userId without replacing the first`
  - `should deduplicate via Set when the same callback reference is registered twice for the same userId`
  - `should keep callback Sets separate per userId when registering for multiple users`

### Phase 2: deregister() — removal and cleanup

- [ ] **Task 2: `deregister()` behavior**
  Files: `src/realtime/services/sync-stream.service.spec.ts`
  Test cases:
  - `should be a no-op when called with an unknown userId`
  - `should be a no-op when called with a callback that was never registered for that userId`
  - `should remove the callback from the Set without deleting the entry when other callbacks remain`
  - `should delete the user entry when the last callback is removed`
  - `should clear the pending debounce timer when the last callback for a userId is removed`
  - `should not affect other users' entries when deregistering a callback for one userId`

### Phase 3: onChangeLogged() — debounce logic

- [ ] **Task 3: `onChangeLogged()` debounce behavior**
  Files: `src/realtime/services/sync-stream.service.spec.ts`
  Test cases:
  - `should be a no-op when the payload's userId is not registered`
  - `should create a 300ms pending timer on the first event for a registered userId`
  - `should append subsequent events to the same pending batch when they arrive within 300ms`
  - `should not create a new timer when an event arrives while a pending batch already exists`
  - `should flush exactly once when multiple events arrive within the debounce window`
  - `should deliver only the LiveEvent fields { id, entity, refId, action } from the payload, with no userId key on the emitted object` — assert via `expect(callback).toHaveBeenCalledWith([{ id, entity, refId, action }])` so that an accidental spread of the whole payload (which would include `userId`) fails the test
  - `should preserve event arrival order (FIFO) in the flushed batch`
  - `should allow a new pending batch to be created after a previous batch has flushed`

### Phase 4: Fan-out delivery

- [ ] **Task 4: Fan-out to multiple callbacks**
  Files: `src/realtime/services/sync-stream.service.spec.ts`
  Test cases:
  - `should invoke every registered callback for a userId with the accumulated events array when the timer fires`
  - `should pass the same events array reference to every callback in a single fan-out`
  - `should deliver events only to callbacks registered for the matching userId, not to callbacks registered for other userIds`
  - `should not invoke a deregistered callback when the timer fires after its removal`

### Phase 5: `for...of` error propagation (documented behavior)

- [ ] **Task 5: Error propagation during flush**
  Files: `src/realtime/services/sync-stream.service.spec.ts`
  Test cases:
  - `should stop iterating callbacks when the first callback throws, leaving subsequent callbacks uninvoked (documented behavior)` — register callbacks A (throws), B, C; after `jest.advanceTimersByTime(300)` assert A was called once, B and C were not called
  - `should surface the thrown error out of the fake-timer tick` — wrap the timer advance in `expect(() => jest.advanceTimersByTime(300)).toThrow(...)`; this assertion is valid only because fake timers run the `setTimeout` callback synchronously from the `advanceTimersByTime` call (under real timers the throw would become a Node `uncaughtException` instead, so the wording deliberately scopes the claim to the fake-timer tick)
  - `should allow a new pending batch to be created on the same userId after a previous flush threw` — after the throwing flush, call `onChangeLogged` again for the same userId, advance timers, and assert the new (non-throwing) callback receives the fresh batch; this pins the behavior that `flush()` sets `entry.pending = null` before the `for...of` loop, so recovery is possible

### Phase 6: onModuleDestroy() — teardown

- [ ] **Task 6: `onModuleDestroy()` behavior**
  Files: `src/realtime/services/sync-stream.service.spec.ts`
  Test cases:
  - `should clear all pending debounce timers across all registered userIds so no callbacks fire afterwards` — register users U1 and U2, trigger `onChangeLogged` for each (timers pending), call `onModuleDestroy()`, then `jest.advanceTimersByTime(1000)` and assert neither callback was invoked
  - `should drop all registrations so a subsequent onChangeLogged for a previously-registered user is a no-op` — behavioral oracle for "Map cleared": after `onModuleDestroy()`, call `onChangeLogged({ userId: 'u1', ... })` for a user that was registered before destroy, advance timers past 300ms, and assert the original callback is not invoked (do NOT inspect `streams.size` directly)
  - `should be safe to call on an empty registry without throwing`
  - `should be safe to call twice in a row without throwing`
