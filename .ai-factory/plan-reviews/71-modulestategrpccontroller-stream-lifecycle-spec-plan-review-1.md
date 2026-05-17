# Plan Review: ModuleStateGrpcController — stream lifecycle spec (rev 1)

**Plan file:** `.ai-factory/plans/71-modulestategrpccontroller-stream-lifecycle-spec.md`
**Target spec file:** `src/realtime/module-state.grpc.controller.spec.ts`
**Test command:** `npx jest src/realtime/module-state.grpc.controller.spec.ts`

## Summary

The plan is well-scoped, accurate against the controller source, and matches the
established spec style in `src/realtime/services/active-stream-registry.service.spec.ts`.
The five phases cover every non-command branch of `trackActivity()` (auth,
reconnect, setup error, teardown) plus the `@OnEvent(SESSION_REVOKED)` handler.
File paths, mocked services, ConfigService keys, RpcException/GrpcStatus usage,
proto response shapes (`sessionState` / `sessionError`), and event payload type
are all consistent with the controller at `src/realtime/module-state.grpc.controller.ts`.

No blocking issues. A few clarifications below would harden the spec; none of them
require restructuring the plan.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)** — WARN: not reviewed inline,
  but the spec is purely additive (a new test file) and respects module
  boundaries (controller depends on `ActivityEngine`, `RateLimiterService`,
  `ActiveStreamRegistry` from the same module, plus `AuthEvents` from
  `users/events/`). No new cross-module dependencies introduced.
- **Rules (`.ai-factory/RULES.md`)** — PASS. Spec adds no production code, so
  the non-null-assertion / sensitive-logging / `@Payload()` rules are not at
  risk. Worth flagging during implementation: avoid `!` in the spec itself too.
- **Roadmap (`.ai-factory/ROADMAP.md`)** — WARN: roadmap milestone alignment
  not verified. Plan title carries a `71-` prefix that suggests a roadmap link;
  confirm the milestone reference during implementation.

## Findings

### 1. Teardown ordering — clarify "invocation" vs "resolution" order (Phase 4, Task 5)

The controller's teardown body is:

```ts
subscriber.add(() => {
  this.activeStreamRegistry.deregister(userId, subscriber);
  ...logging...
  (async () => {
    await this.activityEngine.handleTransportDisconnect(userId);
  })().catch(...);
  this.rateLimiterService.evict(`activity-start:${userId}`);
});
```

`handleTransportDisconnect` is **fire-and-forget**. The synchronous call order
is `deregister → handleTransportDisconnect (invocation) → evict`, but `evict`
runs before `handleTransportDisconnect` resolves.

- The test `should invoke teardown actions in order: deregister → handleTransportDisconnect → evict`
  is correct **only if it checks mock invocation order**, not "evict ran after the
  promise resolved." Recommend phrasing the assertion as
  `expect(deregister.mock.invocationCallOrder[0]).toBeLessThan(handleTransportDisconnect.mock.invocationCallOrder[0])`
  etc., to make the contract explicit.
- The test `should still call rateLimiterService.evict when handleTransportDisconnect rejects`
  must not await the rejection before asserting `evict` was called — `evict` is
  already called synchronously regardless.

Add a one-line note to Phase 4 stating: "teardown calls `handleTransportDisconnect`
as fire-and-forget; ordering assertions are on synchronous call order."

### 2. Phase 4 needs a precondition for the "request observable completes/errors" cases

The cases:
- `should run teardown when the request observable completes`
- `should run teardown when the request observable errors`

require `setup()` to have already resolved (those subscriptions only exist
after `await this.activityEngine.handleReconnect(userId)`). The plan does not
say how the request observable should be modelled. Recommend the harness use a
`Subject<StateRequest>` (or similar) so each test can:

1. Mock `handleReconnect` to resolve (with `null` or a session).
2. Await microtasks (`await Promise.resolve()` once or twice, or use
   `await new Promise(setImmediate)`) so `setup()` finishes wiring `request.subscribe(...)`.
3. Call `subject.complete()` / `subject.error(new Error('x'))`.
4. Assert teardown ran.

Mention this in Task 1 (the scaffolding task) so all later tests share the
same Subject-based request mock.

### 3. Phase 3 — "subscriber.closed already true" timing

`should not emit RESUMED when subscriber.closed is already true by the time handleReconnect resolves`
requires controlling promise resolution timing. Suggest the spec uses a
manually-resolved promise:

```ts
let resolveReconnect: (s: ModuleSession | null) => void;
handleReconnect.mockReturnValue(new Promise(r => { resolveReconnect = r; }));

const out$ = controller.trackActivity(request$, user);
const cleanup = out$.subscribe({ next: ... });
cleanup.unsubscribe();         // closes the subscriber
resolveReconnect(fakeSession); // setup proceeds, hits subscriber.closed check
await flushPromises();
expect(nextSpy).not.toHaveBeenCalled();
```

A short note in Task 3 about the manual-resolve pattern would prevent the
implementer from writing a flaky `setTimeout`-based test.

### 4. Missing (optional) coverage gap — setup error still runs teardown

When `setup()` rejects, the controller calls `subscriber.complete()`, which
triggers the teardown function registered via `subscriber.add(...)`. That
means `deregister` + `evict` (+ fire-and-forget `handleTransportDisconnect`)
still run on setup-error paths. The plan covers "complete after error" but
does not assert that teardown actions executed in the setup-error scenario.

Recommend adding to Phase 3 (Task 4):
- `should call activeStreamRegistry.deregister(userId, subscriber) when setup fails`
- `should call rateLimiterService.evict(...) when setup fails`

This catches a regression where a future refactor moves the teardown
registration above or inline with the failing await.

### 5. Phase 1 mock surface — minor

`ActiveStreamRegistry`'s real method `closeAll` calls `subscriber.complete()`
on every stored subscriber. The plan correctly lists `closeAll` as a mocked
`jest.fn`, so the SESSION_REVOKED tests won't accidentally tear down the
test's own subscriber. Good. No change needed — just confirming it's right.

Mocking `getActiveSession`, `startActivity`, `endActivity`, `pauseActivity`,
`unpauseActivity` is defensive but unused in this milestone. Fine to keep
for symmetry, but flag in the task: "out-of-scope methods are mocked only to
satisfy types; no assertions in this milestone."

### 6. `@Payload()` rule alignment (RULES.md)

The controller method signature is:

```ts
trackActivity(
  @Payload() request: Observable<StateRequest>,
  @GrpcCurrentUser() user: JwtPayload | null,
)
```

This already matches the project rule. When the spec calls
`controller.trackActivity(requestObservable, user)` directly (bypassing the
Nest pipeline), no decorator behaviour is involved — so the rule is preserved.
No action needed.

### 7. Auth-path test — "should error with UNAUTHENTICATED RpcException"

Asserting the error shape requires checking that the thrown value is an
`RpcException` with `code: GrpcStatus.UNAUTHENTICATED`. Recommend the task
text spell out the assertion:

```ts
expect(err).toBeInstanceOf(RpcException);
expect(err.getError()).toEqual({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' });
```

Otherwise the implementer may write `toThrow(/UNAUTHENTICATED/)` and miss the
structured payload.

## Positive Notes

- Phases are ordered to build incrementally (scaffolding → auth → happy path → error path → teardown → handler), matching the controller's logical flow.
- All proto field references (`sessionState.moduleSessionId`, `sessionState.status = RESUMED`, `sessionState.isPaused`, `sessionError.code = INTERNAL_ERROR`) match `proto/generated/module_state` usage in the controller.
- The `RealtimeConfig` keys (`RATE_LIMIT_ACTIVITY_START_PER_MIN`, `RATE_LIMIT_WINDOW_MS`) are accurate.
- `AuthEvents.SESSION_REVOKED` payload type (`{ userId: string }`) matches `src/users/events/auth.events.ts`.
- The plan correctly excludes command-routing (deferred to a follow-up milestone) — keeps this PR-sized.
- Test naming style ("should ...") matches the sibling spec in `services/active-stream-registry.service.spec.ts`.

## Verdict

Plan is implementable as-written. The findings above are clarifications, not
blockers — they should be folded into task descriptions to prevent flaky tests
or under-specified assertions during implementation.

PLAN_REVIEW_PASS
