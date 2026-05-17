# ActiveStreamRegistry — Test Plan

**Date:** 2026-05-17
**Source:** roadmap-test-coverage agent

## Source Overview

`ActiveStreamRegistry` maintains a registry of RxJS Subscribers grouped by userId. Its primary role is to track active realtime streams so they can be closed in bulk — particularly when a user's session is revoked (logout). It implements `OnModuleDestroy` for graceful shutdown.

## Instantiation

No external dependencies — direct instantiation:

```typescript
service = new ActiveStreamRegistry();
```

No mocks required. Use real `Subscriber` instances: `new Subscriber()` or `new Subscriber({ next: () => {} })`. To verify `complete()` calls, spy: `jest.spyOn(subscriber, 'complete')`.

## Existing Coverage

None.

## Test Cases

### Constructor

- should initialize with empty registry (`size === 0`)

### `register()`

- should register a subscriber for a userId not yet in the map
- should add a second subscriber to the same userId without replacing the first
  - Assert: `size === 2`
- should support multiple users with multiple subscribers each
- should be idempotent when same subscriber reference registered twice (Set deduplication)

### `deregister()`

- should remove a subscriber and decrease size
- should be idempotent when called for unknown userId — no error, no crash
- should be idempotent when called twice for the same subscriber
- should delete the user's entry when last subscriber is deregistered (no empty Set left)
- should not leave empty user entry in multi-user scenario

### `closeAll(userId)`

- should call `complete()` on every subscriber for that userId
  - Setup: `jest.spyOn(subscriber, 'complete')` for each
- should delete the user's entry after closeAll
- should be idempotent when called for non-existent userId — no error
- should not affect other users' subscribers

### `size` getter

- returns 0 for empty registry
- returns total count across all users (not unique user count)
- decreases when subscriber deregistered
- is 0 after closeAll

### `onModuleDestroy()`

- should call `complete()` on all subscribers across all users
- should clear the entire registry (`size === 0` after)
- should be safe to call on an empty registry
- should allow subsequent register calls after destroy (Map is re-usable)

### Scenarios

- **Logout flow**: register for user1+user2, closeAll(user1) — only user1's streams closed, user2 untouched
- **Re-registration after closeAll**: register, closeAll, register again — size correct
- **Rapid register/deregister cycles**: loop register+deregister — size remains correct, no corruption

## Gotchas

1. **Set-based storage** — same subscriber reference registered twice is deduplicated. Different function/object references are separate entries.
2. **`deregister()` deletes the entire user Set when empty** (lines 29–31) — important for memory efficiency; test this cleanup explicitly.
3. **Subscribers must be real** — `jest.fn()` cannot replace a Subscriber. Use `new Subscriber()` and `jest.spyOn(sub, 'complete')`.
4. **`onModuleDestroy()` must be called manually** in unit tests (NestJS lifecycle doesn't run automatically without `module.close()`).
5. **`complete()` is idempotent** — calling it twice on the same subscriber is safe.
6. **`size` is O(n) in number of users** — iterates all Sets; fine in tests.
