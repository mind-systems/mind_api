# Test Plan: ModuleStateGrpcController — command routing spec

## Context

This milestone extends `src/realtime/module-state.grpc.controller.spec.ts` (created
in the previous milestone) with a new `describe('command routing')` block that
exercises `ModuleStateGrpcController.routeCommand()` indirectly — by subscribing
to `controller.trackActivity(request$, user)` and emitting `StateRequest` messages
through the `request$` `Subject`. All five command branches
(`activityStart`, `activityEnd`, `activityStop`, `activityPause`, `activityResume`),
the empty-command fallthrough, and the unhandled-error catch path must be
covered. No new mock factory or constructor wiring is required — reuse the
`makeActivityEngine`, `makeRateLimiterService`, `makeActiveStreamRegistry`,
`makeConfigService`, `makeUser`, `makeSession`, and `flushMicrotasks` helpers
already present at the top of the spec.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/realtime/module-state.grpc.controller.spec.ts`

## Target Spec File
`src/realtime/module-state.grpc.controller.spec.ts`

## Notes for the implementer

- Add a single top-level `describe('trackActivity — command routing', () => { ... })`
  block inside the existing outer `describe('ModuleStateGrpcController')` block
  (the routing `describe` must sit **inside** the outer
  `describe('ModuleStateGrpcController')`, not outside it).
- Reuse a small helper (define it **inside** the new routing `describe` block,
  not at file scope) that mirrors `setupConnectedStream` from Task 5 — it should:
  1. Create `request$ = new Subject<StateRequest>()`.
  2. Subscribe to `controller.trackActivity(request$, user)` and collect emitted
     `StateResponse` values into a `values` array.
  3. `await flushMicrotasks()` so the async `setup()` completes and `request$`
     is subscribed to before tests emit commands.
  4. Return `{ sub, request$, values }`.
- Emit commands with `request$.next({ activityStart: { activityType: ..., refId: ... } })`,
  etc. `StateRequest` fields are all optional in the generated proto types, so
  `request$.next({})` is type-safe — no cast needed. After each
  `request$.next(...)`, `await flushMicrotasks()` to allow the async branches in
  `routeCommand` to resolve.
- Use `ActivityStatus` and `ActivityType` enums imported from
  `../../proto/generated/module_state`.
- **Mock shapes — `ModuleSession` vs `ActivityState`.** The existing
  `makeSession` helper returns `{ id: 'session-1' }` and is correct only for
  engine methods that return `ModuleSession` and whose `.id` the controller
  reads — namely `handleReconnect`, `startActivity`, `endActivity`,
  `stopActivity`. It is **wrong** for the three engine methods that return
  `ActivityState` and whose `.sessionId` the controller reads:
  - `activityEngine.getActiveSession(userId)` — read in `handleActivityStart`
    as `existing.sessionId`.
  - `activityEngine.pauseActivity(userId)` — read in `handleActivityPause` as
    `state.sessionId`.
  - `activityEngine.unpauseActivity(userId)` — read in `handleActivityResume`
    as `state.sessionId`.

  For these three, define a small local helper inside the routing `describe`
  block, e.g.:
  ```ts
  function makeActivityState(
    overrides?: Partial<{ sessionId: string; isPaused: boolean }>,
  ) {
    return { sessionId: 'session-1', isPaused: false, ...overrides } as any;
  }
  ```
  and mock the three methods above with `makeActivityState(...)` — **never**
  `makeSession()`. Using `makeSession()` here would leave `moduleSessionId`
  `undefined` on the emitted response and every `toBe('session-1')` assertion
  would fail.
- For the rate-limit branch (Task 1), explicitly stub
  `rateLimiterService.consume.mockReturnValueOnce(false)` (or
  `.mockReturnValue(false)`) — the default mock returns `true`.
- For `pauseActivity` / `unpauseActivity` error paths, mock the engine method to
  throw a `new Error('no_active_session')` etc. — `routeCommand` reads the
  thrown error's `.message` as the `code`.
- For the "stream stays open" assertion in the unhandled-error case, assert that
  the outer subscription `sub.closed === false` after the response is observed,
  and that no `complete` or `error` callback fired on the outer subscriber.
- Verify `isPaused` presence/absence by reading the actual `sessionState` object
  off the emitted `StateResponse` — use `'isPaused' in values[i].sessionState`
  rather than `toMatchObject` (which would pass for missing fields too).
- The INTERNAL_ERROR test exercises the **inner** `try/catch` inside
  `routeCommand` only — that handler catches the engine error and emits
  INTERNAL_ERROR via `subscriber.next`, after which `routeCommand` resolves
  normally. The outer `.catch` chained to `routeCommand(...)` in `setup()` is
  therefore not reachable from a mocked-engine-throw and is intentionally out
  of scope for this milestone — do not write a test for it.

## Tasks

### Phase 1: ActivityStart command

- [x] **Task 1: `describe('trackActivity — command routing → ActivityStart')`**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test cases:
  - `should emit sessionError RATE_LIMIT_EXCEEDED when rateLimiterService.consume returns false`
  - `should not call activityEngine.startActivity when rate limit is exceeded`
  - `should emit sessionState ACTIVE with existing moduleSessionId when activityEngine.getActiveSession returns a session` (mock `getActiveSession` with `makeActivityState({ sessionId: 'session-1' })`, not `makeSession()`)
  - `should not call activityEngine.startActivity when an active session already exists`
  - `should emit sessionError INVALID_ACTIVITY_TYPE when cmd.activityType is unsupported (e.g. ACTIVITY_TYPE_UNSPECIFIED)`
  - `should not call activityEngine.startActivity when activityType is unsupported`
  - `should call activityEngine.startActivity(userId, { activityType: BREATH, activityRefId: cmd.refId }) on the happy path`
  - `should emit sessionState ACTIVE with moduleSessionId from the returned session on the happy path`
  - `should forward cmd.refId to the engine as activityRefId (string value preserved)`
  - `should omit the isPaused field from the emitted sessionState on the happy path`
  - `should omit the isPaused field from the emitted sessionState when returning an existing session`

### Phase 2: ActivityEnd command

- [x] **Task 2: `describe('trackActivity — command routing → ActivityEnd')`**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test cases:
  - `should call activityEngine.endActivity(userId) when ActivityEnd is received`
  - `should emit sessionState COMPLETED with moduleSessionId from the returned session`
  - `should not emit any StateResponse when endActivity resolves to null`
  - `should omit the isPaused field from the emitted sessionState on COMPLETED`

### Phase 3: ActivityStop command

- [x] **Task 3: `describe('trackActivity — command routing → ActivityStop')`**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test cases:
  - `should call activityEngine.stopActivity(userId) when ActivityStop is received`
  - `should emit sessionState INTERRUPTED with moduleSessionId from the returned session`
  - `should not emit any StateResponse when stopActivity resolves to null`
  - `should omit the isPaused field from the emitted sessionState on INTERRUPTED`

### Phase 4: ActivityPause command

- [x] **Task 4: `describe('trackActivity — command routing → ActivityPause')`**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test cases:
  - `should call activityEngine.pauseActivity(userId) when ActivityPause is received`
  - `should emit sessionState ACTIVE with isPaused: true and moduleSessionId from the returned state on success` (mock `pauseActivity` with `makeActivityState({ sessionId: 'session-1', isPaused: true })`, not `makeSession()`)
  - `should emit sessionError with code 'no_active_session' when pauseActivity throws new Error('no_active_session')`
  - `should emit sessionError with code 'already_paused' when pauseActivity throws new Error('already_paused')`
  - `should not emit a sessionState when pauseActivity throws`

### Phase 5: ActivityResume command

- [x] **Task 5: `describe('trackActivity — command routing → ActivityResume')`**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test cases:
  - `should call activityEngine.unpauseActivity(userId) when ActivityResume is received`
  - `should emit sessionState ACTIVE with isPaused: false and moduleSessionId from the returned state on success` (mock `unpauseActivity` with `makeActivityState({ sessionId: 'session-1', isPaused: false })`, not `makeSession()`)
  - `should emit sessionError with code 'no_active_session' when unpauseActivity throws new Error('no_active_session')`
  - `should emit sessionError with code 'not_paused' when unpauseActivity throws new Error('not_paused')`
  - `should not emit a sessionState when unpauseActivity throws`

### Phase 6: Empty command and unhandled errors

- [x] **Task 6: `describe('trackActivity — command routing → empty / unhandled')`**
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Test cases:
  - `should emit sessionError INVALID_COMMAND when StateRequest has no command field set`
  - `should not call any of the routing-dispatched activityEngine methods (startActivity, endActivity, stopActivity, pauseActivity, unpauseActivity) when StateRequest is empty` — scope the assertion to those five methods only. `activityEngine.handleReconnect` is already called once during `setupConnectedStream` and an unqualified "no engine method called" assertion would fail; if a broader assertion is preferred, call `jest.clearAllMocks()` (or per-method `mockClear()`) immediately after the setup helper resolves and before `request$.next({})`.
  - `should emit sessionError INTERNAL_ERROR when a handler throws unexpectedly (e.g. activityEngine.endActivity rejects with a generic Error)`
  - `should keep the outer subscription open after emitting INTERNAL_ERROR (sub.closed === false, complete/error not called)`
  - `should continue routing subsequent commands after an INTERNAL_ERROR (next command after the failing one still produces a response)`
