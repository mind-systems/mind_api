# Code Review (round 2): Client-started root + `activity_type` discriminator + reject root end

**Plan:** `.ai-factory/plans/24-client-started-root-activity-type-discriminator-reject-root-end.md`
**Scope reviewed:** `proto/module_state.proto`, `proto/generated/module_state.ts`, `src/realtime/module-state.grpc.controller.ts`, `src/realtime/services/activity-engine.service.ts`
**Result:** 🔴 One blocking regression — a previously-green committed test now fails.

## What changed since review-1
Review-1's blocking finding (the `CANNOT_END_ROOT` guard firing on `resolved.sessionId === undefined`) was **correctly fixed**. Both guards now read:

```ts
const endRootId = this.activityEngine.getRootId(userId);
if (resolved.sessionId !== undefined && resolved.sessionId === endRootId) { ... }   // :448-449
const stopRootId = this.activityEngine.getRootId(userId);
if (resolved.sessionId !== undefined && resolved.sessionId === stopRootId) { ... }   // :489-490
```

The a1 acceptance suite is now fully green:
- `npx jest src/realtime/module-state.grpc.controller.spec.ts` → **66 passed, 66 total**.
- `npx tsc --noEmit` → no errors in any changed file (the `biometric-stream-engine.service.spec.ts` errors are pre-existing and outside this diff).

## Critical Issue (blocking): regression in `concurrency-idempotency.spec.ts`

Running the **whole** realtime suite reveals the fix introduced a new failure that review-1 did not surface (review-1 only ran the a1 spec):

- `npx jest src/realtime` with this change → **6 failed**.
- Same command with the three source files reverted to HEAD → **5 failed**.

I isolated the delta per-suite (source reverted via `git stash` of `proto/module_state.proto` + the two `.ts` files, then restored):

| Suite | At HEAD (base) | With this change |
|---|---|---|
| `module-biometric-stream.grpc.controller.spec.ts` | 2 failed (`[RED until note 35]`) | 2 failed — unchanged, pre-existing |
| `module-instruction-stream.grpc.controller.spec.ts` | 3 failed (`RED until note 36`) | 3 failed — unchanged, pre-existing |
| `concurrency-idempotency.spec.ts` | **0 failed (11 passed)** | **1 failed** ← regression |

The 5 biometric/instruction failures are intentional future-spec reds (their test names declare `RED until note 35` / `note 36`) and are **not** caused by this change. The concurrency suite, however, was **green at base and is red with this change**.

### Failing test
`concurrent activities + idempotency dedup › [TARGET — RED until spec 06] session_id routing › should route pause/resume/end/stop to the child named by sessionId as the second positional argument`

(Despite the `RED until spec 06` label in the describe block, this specific test currently **passes** at HEAD — the session_id routing it asserts already shipped in an earlier commit. So it is a live green test, not a dormant target.)

```
expect(activityEngine.endActivity).toHaveBeenCalledWith('user-1', 'session-A', undefined)
Number of calls: 0
```

The test sends `activityPause`, `activityResume`, `activityEnd`, `activityStop` each with explicit `sessionId: 'session-A'`. Pause and resume still pass (no guard on them). `endActivity`/`stopActivity` are now **never called**.

### Root cause
This spec's engine mock factory `makeActivityEngine` (`concurrency-idempotency.spec.ts:60-80`) does **not** define `getRootId` — the mock object has `endActivity`, `stopActivity`, `pauseActivity`, `listLiveSessions`, `getSoleChild`, etc., but no `getRootId`. So at runtime `this.activityEngine.getRootId` is `undefined`, and the new unconditional call `this.activityEngine.getRootId(userId)` in `handleActivityEnd` (`:448`) and `handleActivityStop` (`:489`) throws `TypeError: this.activityEngine.getRootId is not a function`. That throw is swallowed by `routeCommand`'s try/catch (`:287-299`) into an `INTERNAL_ERROR` frame, so `endActivity`/`stopActivity` are never reached → 0 calls → assertion fails.

Pause/resume are unaffected because they carry no root guard and therefore never touch `getRootId`.

### This is a test-mock gap, not a production defect
In production `ActivityEngine.getRootId` is a real method (`activity-engine.service.ts:541-543`, the delegate added by this task), so the guard works correctly against the live engine. The only place it breaks is the `concurrency-idempotency.spec.ts` mock, which is now stale relative to the controller's expanded engine dependency. But the milestone must not leave a previously-green committed test red.

### Required fix
Add `getRootId` to the mock factory in `concurrency-idempotency.spec.ts:60-80`, mirroring how `module-state.grpc.controller.spec.ts:40` already provides it:

```ts
getRootId: jest.fn().mockReturnValue(null),
```

Returning `null` (the store's real "no root" value) keeps `'session-A' === null` false, so the routing test passes again. Re-run `npx jest src/realtime/concurrency-idempotency.spec.ts` to confirm 11/11, and `npx jest src/realtime` to confirm only the pre-existing note-35/note-36 reds remain (5 failed, no new ones).

Scope is contained: only two specs construct `ModuleStateGrpcController` — `module-state.grpc.controller.spec.ts` (already mocks `getRootId`, green) and `concurrency-idempotency.spec.ts` (missing it, this regression). No other suite is affected.

## Non-blocking observations (verified correct)
- Proto change additive and correctly regenerated: `ActivityType.ROOT = 3`, `StateEvent.activityType: ActivityType` (required) present in `proto/generated/module_state.ts`.
- `mapInternalActivityType` is total (`default → ACTIVITY_TYPE_UNSPECIFIED`, no throw); start frame discriminator derives from the local mapped `activityType`; cache-hit ordering fixed; ROOT routed through `ensureRoot`; ABANDONED stamps `UNSPECIFIED`; rate-limit + idempotency retained on both paths. All unchanged from review-1 and correct.
- `getRootId` delegate on `ActivityEngine` returns `string | null` from the store — matches the contract.
- No new migration required — correct.
- Rules/architecture: no non-null assertion, logging stays ID-only, change stays within the realtime module boundary.

## Required action
Add `getRootId: jest.fn().mockReturnValue(null)` to `makeActivityEngine` in `src/realtime/concurrency-idempotency.spec.ts`, then confirm `npx jest src/realtime` shows no failures beyond the pre-existing note-35/note-36 targets.
