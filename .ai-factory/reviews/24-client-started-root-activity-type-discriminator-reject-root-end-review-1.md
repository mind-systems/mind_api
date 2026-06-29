# Code Review: Client-started root + `activity_type` discriminator + reject root end

**Plan:** `.ai-factory/plans/24-client-started-root-activity-type-discriminator-reject-root-end.md`
**Scope reviewed:** `proto/module_state.proto`, `proto/generated/module_state.ts`, `src/realtime/module-state.grpc.controller.ts`, `src/realtime/services/activity-engine.service.ts`
**Result:** 🔴 One blocking correctness bug — 11 committed acceptance tests fail.

## Verification performed
- `npx tsc --noEmit` — no type errors in any changed file. (Pre-existing, unrelated errors in `biometric-stream-engine.service.spec.ts` are not part of this diff and not introduced here.)
- Generated stubs regenerated correctly: `ActivityType.ROOT = 3` and `StateEvent.activityType: ActivityType` (required) both present in `proto/generated/module_state.ts`.
- `npx jest src/realtime/module-state.grpc.controller.spec.ts` → **11 failed, 55 passed**.

## Critical Issue (blocking)

### The `CANNOT_END_ROOT` guard fires spuriously when no session is resolved — breaks `activity:end` / `activity:stop` with no explicit `sessionId`

`module-state.grpc.controller.ts:448` (end) and `:488` (stop):

```ts
if (resolved.sessionId === this.activityEngine.getRootId(userId)) {
  subscriber.next({ sessionError: { code: 'CANNOT_END_ROOT', ... } });
  return;
}
```

`resolveTargetSession` returns `{ ok: true, sessionId: undefined }` for the legitimate "no explicit id, zero sole child — let the engine decide" path (`:341-342`). When `resolved.sessionId` is `undefined` and `getRootId(userId)` also yields a falsy/undefined value, the comparison becomes `undefined === undefined` → **true**, so the guard fires `CANNOT_END_ROOT` and `endActivity`/`stopActivity` are never called.

This is the single root cause of all 11 test failures. The committed acceptance spec mocks `getRootId: jest.fn()` (`spec:40`, default return `undefined`). Every end/stop test that sends `{ activityEnd: {} }` / `{ activityStop: {} }` with no explicit `sessionId` resolves to `sessionId: undefined`, hits `undefined === undefined`, and gets `CANNOT_END_ROOT` instead of the expected behavior. Concretely failing:
- `ActivityEnd › should call activityEngine.endActivity(userId)…` — `endActivity` never invoked.
- `ActivityEnd › should emit sessionState COMPLETED…`, `…not emit when endActivity resolves to null`, `…omit isPaused on COMPLETED`.
- `ActivityStop ›` the same four cases for `stopActivity`/`INTERRUPTED`.
- `empty / unhandled › …INTERNAL_ERROR when a handler throws…` (x3) — the guard short-circuits before the rejecting `endActivity` mock runs, so `Received: "CANNOT_END_ROOT"` instead of `"INTERNAL_ERROR"`.

The two explicit-root tests (`spec:464`, `:493`) pass only because they set `getRootId.mockReturnValue('root-1')` and send `sessionId: 'root-1'` — a real string match.

**Why this is a real bug, not just a mock artifact:** the guard conflates "no target was resolved" (`sessionId === undefined`, the engine-decides sentinel) with "the target is the root." In production `getRootId` happens to return `string | null` (`activity-session-store.service.ts:79-81`), so `undefined === null` is `false` and the bug is masked at runtime — but the code must not depend on that null-vs-undefined accident, and the committed a1 acceptance gate (the whole point of this milestone) is RED as written. The guard must only fire when an actual session was resolved.

**Fix** (both `handleActivityEnd` and `handleActivityStop`):

```ts
const rootId = this.activityEngine.getRootId(userId);
if (rootId !== null && resolved.sessionId === rootId) {
  subscriber.next({ sessionError: { code: 'CANNOT_END_ROOT', ... } });
  return;
}
```

or equivalently guard the left side: `if (resolved.sessionId !== undefined && resolved.sessionId === this.activityEngine.getRootId(userId))`. After this change the guard fires only for an explicitly-resolved root id, and all 11 tests go green (the explicit-root tests still match on `'root-1'`).

## Non-blocking observations (correct as written)

- **Proto change** is additive and minimal: `ROOT = 3`, `activity_type = 4`, no `is_root`, no request-shape change. Field numbers are the next free slots. Generated enum/interface match. ✅
- **`mapInternalActivityType`** is total (`default → ACTIVITY_TYPE_UNSPECIFIED`, no throw) as required; the `void _exhaustive` is compile-time-only. ✅
- **Start frame discriminator** correctly derives from the local mapped `activityType` variable (not `session.activityType`), so the ROOT-start test's `activityType === 3` holds even though the mocked `ensureRoot` session carries no type. ✅
- **Cache-hit ordering** fixed — `mapProtoActivityType` runs before the idempotency short-circuit, so the cache-hit frame carries the required `activityType`. ✅
- **ROOT routing** goes through `ensureRoot` (idempotent, `rootSessionId=null`), never `startActivity`. Rate-limit and `clientActivityId` dedup retained on both paths. ✅
- **ABANDONED frame** stamps `ACTIVITY_TYPE_UNSPECIFIED` (the required field has no concrete type to assert). ✅
- **`getRootId` delegate** added to `ActivityEngine` (`:541-543`), returning `string | null` from the store — matches the store contract. ✅
- **No new migration** — correct; `activityType=root` already exists. ✅
- **Rules/architecture:** no non-null assertion introduced, logging stays ID-only, change stays within the `realtime` module. ✅
- **Consumer regen** (mind_mobile copy + regenerate, handoff 12) is correctly scoped out to a follow-up — informational only.

## Required action
Add the `resolved.sessionId !== undefined` (or `rootId !== null`) condition to the `CANNOT_END_ROOT` guard in both `handleActivityEnd` and `handleActivityStop`, then re-run `npx jest src/realtime/module-state.grpc.controller.spec.ts` to confirm 66/66 green.
