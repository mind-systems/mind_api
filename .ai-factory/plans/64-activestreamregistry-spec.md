# Test Plan: ActiveStreamRegistry spec

## Context
`ActiveStreamRegistry` (`src/realtime/services/active-stream-registry.service.ts`) maintains a `Map<userId, Set<Subscriber>>` tracking active RxJS streams per user. It supports bulk closing on logout and clean shutdown via `OnModuleDestroy`. No spec exists; this plan covers all public methods, the `size` getter, and lifecycle behavior using real `Subscriber` instances (no mocks).

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/realtime/services/active-stream-registry.service.spec.ts`

## Target Spec File
`src/realtime/services/active-stream-registry.service.spec.ts`

## Tasks

### Phase 1: ActiveStreamRegistry — initial state and `register()`

- [x] **Task 1: Initial state**
  Files: `src/realtime/services/active-stream-registry.service.spec.ts`
  Test cases:
  - `should report size 0 when newly instantiated`

- [x] **Task 2: `register()` behavior**
  Files: `src/realtime/services/active-stream-registry.service.spec.ts`
  Test cases:
  - `should create a new Set and add the subscriber when registering the first subscriber for a userId`
  - `should add a second subscriber to the same userId without replacing the first when registering twice for one user`
  - `should keep separate Sets per user when registering subscribers for multiple userIds`
  - `should be idempotent when the same subscriber reference is registered twice for the same userId` (size increments only by 1 on duplicate)

### Phase 2: `deregister()` behavior

- [x] **Task 3: `deregister()` removes and cleans up**
  Files: `src/realtime/services/active-stream-registry.service.spec.ts`
  Test cases:
  - `should remove the subscriber and decrease size when deregistering a known subscriber`
  - `should delete the user's Set entirely when its last subscriber is deregistered` (verify by registering a new subscriber for the same userId afterwards and confirming size reflects fresh entry; or by checking that subsequent `closeAll(userId)` is a no-op)
  - `should be a no-op when called with an unknown userId` (no throw, size unchanged)
  - `should be a no-op when called with a subscriber that was never registered for that userId` (size unchanged)
  - `should not affect other users' Sets when deregistering a subscriber for one userId`

### Phase 3: `closeAll()` behavior

- [x] **Task 4: `closeAll()` completes and clears subscribers per user**
  Files: `src/realtime/services/active-stream-registry.service.spec.ts`
  Test cases:
  - `should call complete() on every subscriber for the given userId` (use `jest.spyOn(subscriber, 'complete')` on each)
  - `should delete the user's Set after completing all subscribers` (size drops by the number of completed subscribers; subsequent `closeAll(userId)` is a no-op)
  - `should be a no-op when called with an unknown userId` (no throw, no spy invocations on other users)
  - `should not call complete() on subscribers belonging to other userIds when closing one user` (verify other-user spies were not called)
  - `should not affect other users' entries in the registry when closing one user` (other user's size contribution preserved)

### Phase 4: `size` getter

- [x] **Task 5: `size` reflects total subscriber count, not unique users**
  Files: `src/realtime/services/active-stream-registry.service.spec.ts`
  Test cases:
  - `should return the sum of subscribers across all users (not the number of users)` (e.g. 2 users with 3 + 2 subscribers → size 5)
  - `should decrease by 1 when one subscriber is deregistered`
  - `should return 0 after closeAll removes the last user's Set`

### Phase 5: `onModuleDestroy()` behavior

- [x] **Task 6: `onModuleDestroy()` completes everything and clears the map**
  Files: `src/realtime/services/active-stream-registry.service.spec.ts`
  Test cases:
  - `should call complete() on every subscriber across all users` (spy on each subscriber across multiple users; all spies called once)
  - `should leave size === 0 after destruction`
  - `should be safe to call on an empty registry` (no throw)
  - `should allow new register() calls to work normally after onModuleDestroy()` (register a fresh subscriber post-destroy; size becomes 1)
