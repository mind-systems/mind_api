# Test Plan: ModuleStateGrpcController — stream lifecycle spec

## Context

`ModuleStateGrpcController.trackActivity()` is a bidirectional gRPC stream endpoint
that authenticates the user, registers the subscriber in `ActiveStreamRegistry`,
resumes existing sessions via `ActivityEngine.handleReconnect`, and runs teardown
on unsubscribe (deregister + transport-disconnect + rate-limit eviction). This
milestone covers the stream lifecycle paths (auth, reconnect, teardown, setup
error) plus the `@OnEvent(SESSION_REVOKED)` handler — it does not cover the
command-routing branches (those will be a follow-up milestone).

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/realtime/module-state.grpc.controller.spec.ts`

## Target Spec File
`src/realtime/module-state.grpc.controller.spec.ts`

## Tasks

### Phase 1: Test scaffolding & auth path

- [x] **Task 1: `describe('ModuleStateGrpcController')` — instantiation & shared mocks**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test cases:
  - Set up `beforeEach` that constructs the controller with mocked `ActivityEngine`
    (jest.fn for `handleReconnect`, `getActiveSession`, `handleTransportDisconnect`,
    `startActivity`, `endActivity`, `stopActivity`, `pauseActivity`, `unpauseActivity`),
    mocked `RateLimiterService` (`consume`, `evict`), mocked `ActiveStreamRegistry`
    (`register`, `deregister`, `closeAll`), and a `ConfigService` whose `get` returns
    sensible numeric defaults for `RATE_LIMIT_ACTIVITY_START_PER_MIN` and
    `RATE_LIMIT_WINDOW_MS`. No test cases at this level — this is the harness only.

- [x] **Task 2: `describe('trackActivity — authentication')`**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test cases:
  - `should error with UNAUTHENTICATED RpcException when user argument is null`
  - `should not call activeStreamRegistry.register when user is null`
  - `should not invoke activityEngine.handleReconnect when user is null`
  - `should call activeStreamRegistry.register(user.sub, subscriber) when user is present`

### Phase 2: Reconnect path

- [x] **Task 3: `describe('trackActivity — reconnect path')`**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test cases:
  - `should emit StateResponse.sessionState with status RESUMED and isPaused false when handleReconnect returns a session`
  - `should include the resumed session id as moduleSessionId in the emitted StateResponse`
  - `should not emit any StateResponse during setup when handleReconnect returns null`
  - `should subscribe to the request observable after handleReconnect resolves`
  - `should not emit RESUMED when subscriber.closed is already true by the time handleReconnect resolves`

### Phase 3: Setup error path

- [x] **Task 4: `describe('trackActivity — setup error')`**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test cases:
  - `should emit StateResponse.sessionError with code INTERNAL_ERROR when handleReconnect rejects`
  - `should call subscriber.complete after emitting INTERNAL_ERROR on setup failure`
  - `should not subscribe to the request observable when setup fails`
  - `should still register the subscriber with activeStreamRegistry before setup runs`

### Phase 4: Stream teardown

- [x] **Task 5: `describe('trackActivity — stream teardown')`**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test cases:
  - `should call activeStreamRegistry.deregister(userId, subscriber) when the consumer unsubscribes`
  - `should call activityEngine.handleTransportDisconnect(userId) on teardown`
  - `should call rateLimiterService.evict('activity-start:{userId}') on teardown`
  - `should invoke teardown actions in order: deregister → handleTransportDisconnect → evict`
  - `should swallow errors thrown by handleTransportDisconnect and not propagate them to the caller`
  - `should still call rateLimiterService.evict when handleTransportDisconnect rejects`
  - `should run teardown when the request observable completes`
  - `should run teardown when the request observable errors`

### Phase 5: SESSION_REVOKED handler

- [x] **Task 6: `describe('handleSessionRevoked')`**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test cases:
  - `should call activityEngine.stopActivity(payload.userId)`
  - `should call activeStreamRegistry.closeAll(payload.userId)`
  - `should call closeAll even when stopActivity throws`
  - `should not rethrow when stopActivity rejects`
  - `should call stopActivity before closeAll`
