# Plan Review: ModuleStateGrpcController — command routing spec

**Plan file:** `.ai-factory/plans/72-modulestategrpccontroller-command-routing-spec.md`
**Target spec:** `src/realtime/module-state.grpc.controller.spec.ts`
**Risk Level:** 🟡 Medium — well-scoped overall, but two concrete factual gaps will trip the implementer.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)**: PASS. Test-only milestone; no module-boundary or dependency-graph implications.
- **Rules (`.ai-factory/RULES.md`)**: PASS. Rules target production code (no non-null assertion, no PII in logs, `@Payload()` decorator). None of them touch this spec file.
- **Roadmap (`.ai-factory/ROADMAP.md`)**: Not re-read in this review; the plan title aligns with milestone-72 numbering already in the plans directory.

## Critical Issues

### 1. `makeSession` helper shape does not match `getActiveSession` / `pauseActivity` / `unpauseActivity` return values

The existing helper returns `{ id: 'session-1' }`:

```ts
function makeSession(overrides?: Partial<{ id: string }>) {
  return { id: 'session-1', ...overrides } as any;
}
```

That shape is fine for `handleReconnect`, `startActivity`, `endActivity`, `stopActivity` — all return `ModuleSession` and the controller reads `session.id`. But the plan also tells the implementer to reuse `makeSession` for cases where the controller reads `.sessionId` instead of `.id`:

- `handleActivityStart` line 219 reads `existing.sessionId` from `activityEngine.getActiveSession(userId)` (returns `ActivityState`, see `services/activity-engine.service.ts:312`).
- `handleActivityPause` line 288 reads `state.sessionId` from `activityEngine.pauseActivity(userId)` (returns `ActivityState`, line 248).
- `handleActivityResume` line 310 reads `state.sessionId` from `activityEngine.unpauseActivity(userId)` (returns `ActivityState`, line 280).

If the implementer naively does
```ts
activityEngine.getActiveSession.mockReturnValue(makeSession());
```
the emitted `moduleSessionId` will be `undefined`, and assertions like
`expect(values[0].sessionState?.moduleSessionId).toBe('session-1')` will fail.

**Fix:** the plan should say explicitly that `getActiveSession`, `pauseActivity`, and `unpauseActivity` must be mocked with an `ActivityState`-shaped object (`{ sessionId: '...' /*, isPaused, etc. */ }`), e.g. via a new tiny `makeActivityState({ sessionId, isPaused = false })` helper. Without this note, expect rework.

Recommended addition under "Notes for the implementer":
> `getActiveSession`, `pauseActivity`, `unpauseActivity` return `ActivityState`, not `ModuleSession`. Mock them with `{ sessionId: '...' }` (not `makeSession()` — that returns `{ id }`).

### 2. "should not call any activityEngine method when StateRequest is empty" needs scoping

`setupConnectedStream` necessarily calls `activityEngine.handleReconnect(userId)` once during setup (controller line 82). By the time the test sends an empty `StateRequest`, the `activityEngine.handleReconnect` mock already has one call. A literal `expect(activityEngine.handleReconnect).not.toHaveBeenCalled()` would fail.

**Fix:** either
- scope the assertion to the routing-relevant methods only:
  `startActivity`, `endActivity`, `stopActivity`, `pauseActivity`, `unpauseActivity` —
  these are the ones `routeCommand` dispatches to; or
- `jest.clearAllMocks()` (or per-method `mockClear()`) right after `setupConnectedStream` resolves, before `request$.next({})`.

The plan currently reads "should not call any activityEngine method when StateRequest is empty" — too broad. Tighten it in Task 6.

## Other Notes (non-blocking)

### A. Rate-limit override (Task 1)

For the rate-limit branch, the implementer needs `rateLimiterService.consume.mockReturnValue(false)` (or `mockReturnValueOnce`) — default mock returns `true`. Worth a one-liner in the task description; obvious, but explicit is friendly.

### B. Empty `StateRequest` literal

`request$.next({})` is type-safe because every field on `StateRequest` is optional in the generated proto types (`proto/generated/module_state.ts:89-95`). No cast needed. Good.

### C. INTERNAL_ERROR test exercises only the inner `try/catch`, not the outer `.catch`

Plan Task 6 says: "when a handler throws unexpectedly (e.g. `activityEngine.endActivity` rejects with a generic Error)". That triggers the **inner** `try/catch` inside `routeCommand` (controller lines 162–191), which catches and emits INTERNAL_ERROR via `subscriber.next` — `routeCommand` then resolves normally, so the outer `.catch` on line 100 in `setup()` never fires.

Functionally the observable behavior (INTERNAL_ERROR emitted, stream stays open) is the same in either case, and that's all the milestone aims to verify, so this is fine. Just be aware: this milestone does **not** cover the outer `.catch` path on `setup()`'s `routeCommand(...).catch(...)`. If full branch coverage was the intent, that path is currently unreachable in practice (would require `subscriber.next` to throw) and can be safely ignored — but worth a sentence in the notes so a future reader doesn't go hunting for it.

### D. `'isPaused' in sessionState` assertion strategy

The plan's recommendation to use `'isPaused' in values[i].sessionState` instead of `toMatchObject` is sound — `toMatchObject({ status: ACTIVE })` would pass even if `isPaused: true` were silently included. Good guidance, keep it.

### E. `handleActivityPause` / `handleActivityResume` are synchronous

The controller calls them without `await` (lines 170, 172). `routeCommand` is still `async` so the wrapping promise still resolves on the microtask queue. `await flushMicrotasks()` after `request$.next(...)` is still correct and safe — just noting that for pause/resume the emit actually happens synchronously within `request$.next`, so an assertion immediately after `next` would also pass. Plan's "always flush" rule is fine.

### F. Helper definition placement

Plan says "define it inside the new block". Reasonable — keeps the routing-block helper visible only to its tests and avoids polluting the file-scope helper area. Just make sure it sits **inside** `describe('trackActivity — command routing', () => { ... })`, not the outer `describe('ModuleStateGrpcController')` — the plan's intent is clear but worth being deliberate.

## Positive Notes

- Five clean per-command phases plus a dedicated empty/unhandled phase — matches the five `else if` branches in `routeCommand` 1:1.
- Test names are specific and behavior-driven (`should emit ...`, `should not call ...`) — readable in failure output.
- Plan correctly notes that `routeCommand` reads `err.message` as the error `code`, so tests must `throw new Error('no_active_session')` (lowercase) — matches `WsErrorCode.NO_ACTIVE_SESSION = 'no_active_session'` in `constants/ws-error-codes.ts`.
- `subscriber.closed === false` plus "no complete/error fired" is the right pair of assertions for proving the stream survives an error response.
- Reuses every existing helper rather than spawning duplicates — keeps the spec file coherent.
- Phase boundaries are independent — implementer can ship phase-by-phase if needed.

## Verdict

Address Critical Issues 1 and 2 (add a `makeActivityState` helper note, and scope the empty-command "no engine method called" assertion). Both are 1-line plan edits that will save the implementer a confused test-failure debug cycle. Everything else can ride.
