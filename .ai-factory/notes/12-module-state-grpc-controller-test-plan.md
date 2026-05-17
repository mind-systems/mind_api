# ModuleStateGrpcController — Test Plan

**Date:** 2026-05-17
**Source:** roadmap-test-coverage agent

## Source Overview

`ModuleStateGrpcController` is a bidirectional streaming gRPC endpoint for real-time activity tracking. `trackActivity()` returns `Observable<StateResponse>` that: (1) authenticates via `@GrpcCurrentUser()` user parameter, (2) registers the subscriber in `ActiveStreamRegistry`, (3) handles reconnect by resuming existing sessions from `ActivitySessionStore`, (4) routes incoming `StateRequest` commands to `ActivityEngine`, (5) starts a grace timer on disconnect. The controller also listens to `SESSION_REVOKED` events to force-close active streams on logout.

## Instantiation

```typescript
const controller = new ModuleStateGrpcController(
  activityEngine,       // mock: handleReconnect, getActiveSession, handleTransportDisconnect, startActivity, endActivity, stopActivity, pauseActivity, unpauseActivity
  rateLimiterService,   // mock: consume(), evict()
  activeStreamRegistry, // mock: register(), deregister(), closeAll()
  configService,        // mock: get() → rate limit constants
);
```

After the Phase 15 refactor, `trackActivity` takes `user: JwtPayload | null` as a typed second argument (via `@GrpcCurrentUser()`). In tests, pass it directly — no metadata object needed.

To simulate the bidi stream in tests: create a mock `Observable<StateRequest>` as the `request` argument and collect emitted `StateResponse` values from the returned Observable via `.subscribe({ next, error, complete })`.

## Existing Coverage

None.

## Test Cases

### Authentication

- should error with UNAUTHENTICATED when user is null
  - Setup: `controller.trackActivity(request$, null)`
- should extract userId from `user.sub`
  - Setup: `controller.trackActivity(request$, { sub: 'user-1', ... })`

### Reconnect Path

- should send `StateResponse.sessionState` with `status: RESUMED` when `handleReconnect()` returns a session
- should cancel grace timer when resuming existing session
- should not send any response during setup when `handleReconnect()` returns null
- should set `connectedAt` timestamp after successful setup

### ActivityStart Command

- should reject with RATE_LIMIT_EXCEEDED when `rateLimiterService.consume()` returns false
- should return existing session state (ACTIVE) when `getActiveSession()` returns a session
- should error with INVALID_ACTIVITY_TYPE for unsupported proto activity type
- should call `startActivity(userId, { activityType, activityRefId })` and emit ACTIVE state
- should pass `cmd.refId` to engine as `activityRefId`

### ActivityEnd Command

- should call `endActivity(userId)` and emit COMPLETED state
- should be a no-op (no next()) when `endActivity()` returns null

### ActivityStop Command

- should call `stopActivity(userId)` and emit INTERRUPTED state
- should be a no-op when `stopActivity()` returns null

### ActivityPause Command

- should call `pauseActivity(userId)` and emit ACTIVE state with `isPaused: true`
- should emit `sessionError` NO_ACTIVE_SESSION when `pauseActivity()` throws that error
- should emit `sessionError` ALREADY_PAUSED when `pauseActivity()` throws that error

### ActivityResume Command

- should call `unpauseActivity(userId)` and emit ACTIVE state with `isPaused: false`
- should emit `sessionError` NO_ACTIVE_SESSION when `unpauseActivity()` throws
- should emit `sessionError` NOT_PAUSED when `unpauseActivity()` throws

### Invalid Commands

- should emit INVALID_COMMAND when `StateRequest` has no command field set
- should catch unhandled errors in `routeCommand` and emit INTERNAL_ERROR (stream stays open)

### Stream Teardown

- should call `activeStreamRegistry.deregister(userId, subscriber)` on unsubscribe
- should call `activityEngine.handleTransportDisconnect(userId)` on stream close
- should call `rateLimiterService.evict('activity-start:{userId}')` on disconnect
- should handle errors from `handleTransportDisconnect` gracefully (catch + log, no rethrow)
- should log `connectedDurationMs` on disconnect

### Setup Errors

- should emit INTERNAL_ERROR + complete when `handleReconnect()` throws
- should not emit if subscriber is closed before `handleReconnect()` resolves (check `subscriber.closed`)
- should propagate error from incoming `request` stream via `subscriber.error()`
- should complete subscriber when `request` stream completes

### SESSION_REVOKED Event

- should call `activeStreamRegistry.closeAll(userId)` when SESSION_REVOKED fires
- should call `activityEngine.stopActivity(userId)` when SESSION_REVOKED fires
- should log error and not throw if `stopActivity()` fails on revoke

## Gotchas

1. **Subscriber lifecycle** — All logic runs inside `new Observable()`. Unsubscribe the subscription to trigger teardown handlers registered via `subscriber.add()`.
2. **Bidi streaming: two Observables** — Mock the `request: Observable<StateRequest>` as the input; collect from returned `Observable<StateResponse>` as output.
3. **Async setup with `replay().catch()`** — `handleReconnect()` is async; tests must await or use `setTimeout` to let setup complete before assertions.
4. **`mapProtoActivityType` is module-level** — Not a method; pass invalid `ProtoActivityType` values to trigger INVALID_ACTIVITY_TYPE.
5. **Pause/Resume are synchronous** — `pauseActivity()` and `unpauseActivity()` throw synchronously; `startActivity/endActivity/stopActivity` are async.
6. **Teardown deregister order** — `activeStreamRegistry.deregister` → `handleTransportDisconnect` → `rateLimiterService.evict`.
7. **`StateEvent.isPaused` field** — Start/End/Stop omit `isPaused`; Pause sends `true`, Resume sends `false`.
8. **Error code from exception message** — Pause/Resume errors: `code = err instanceof Error ? err.message : 'NO_ACTIVE_SESSION'`. Match exact `WsErrorCode` strings.
9. **`@OnEvent` decorator** — `handleSessionRevoked()` must be called directly in unit tests; EventEmitter not triggered automatically.
10. **User is a plain typed parameter (after Phase 15 refactor)** — pass `mockUser` directly as second argument to `trackActivity(request$, mockUser)`. No `Metadata` object, no `GRPC_USER_KEY` constant needed in tests.
