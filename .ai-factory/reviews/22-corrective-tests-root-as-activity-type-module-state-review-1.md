# Code Review: Corrective tests — root-as-activity-type (module-state)

**Change under review:** `src/realtime/module-state.grpc.controller.spec.ts` (test-only)
**Reviewed against:** controller source (`module-state.grpc.controller.ts`), generated stub (`proto/generated/module_state.ts`), plan, notes 34/37.
**Scope:** No production / proto / migration changes. The only code change is the spec file; the other staged files are plan/review docs.

## Summary

The reverts are correct and the suite compiles. Every reverted reconnect case ((a) RESUMED, fresh-connect, (b) ABANDONED, (c), (d)) now matches the **actual current controller behavior**, so they are genuinely GREEN characterization:
- `setup()` emits RESUMED only for a resolved session, ABANDONED only when `clientSessionId` is present, and nothing on a fresh `null` reconnect (controller `:128-149`). `ensureRoot` (`:154`) emits no frame. The reverted length/shape assertions line up exactly.
- The two review-1 blockers are fixed: discriminator reads the camelCased `activityType` (matches ts-proto — stub confirms `activity_type → activityType`), and `makeSession` is called without the excess `activityType` property.

The compile-now strategy is sound: `ActivityType` has no `ROOT` (enum stops at `MEDITATION = 2`), so `3 as ActivityType` resolves to `mapProtoActivityType`'s `default` arm → `RpcException` → `INVALID_ACTIVITY_TYPE` today. `StateEvent` has no `activityType` field yet, so the `as any` cast reads `undefined` today. Both give the intended RED.

I verified each new target against the controller for true two-state behavior. **One target does not go RED today** (a false-GREEN), which defeats its purpose; details below.

---

## Findings

### 1. (Medium) "routes through ensureRoot, not startActivity" is GREEN today — the target has no RED signal

`module-state.grpc.controller.spec.ts:390-408`:

```ts
expect(activityEngine.ensureRoot).toHaveBeenCalled();
expect(activityEngine.startActivity).not.toHaveBeenCalled();
```

Both assertions already pass **before a1**, so this target can never fail and cannot detect whether a1 actually implements ROOT → `ensureRoot` routing:

- `ensureRoot` is called **unconditionally during connect** in `setup()` (controller `:153-154`: `if (subscriber.closed) return; await this.activityEngine.ensureRoot(userId);`). By the time the test's `flushMicrotasks()` completes, `ensureRoot` has already been called once — independent of the ROOT command. So `toHaveBeenCalled()` is satisfied by the connect, not by the command.
- Today the ROOT command throws in `mapProtoActivityType` (`:360-361`) **before** `startActivity` (`:372`) is reached, so `startActivity` is correctly never called.

Result: the test is GREEN today and GREEN after a1 — it provides zero protection and would still pass even if a1 never wired ROOT to `ensureRoot`. This violates the milestone's explicit two-state-observability requirement ("prove RED-now and GREEN-after"), and it is exactly the silent-hole class this epic exists to guard.

**Fix:** isolate the command's effect by clearing the connect-time call before sending the ROOT command:

```ts
await flushMicrotasks();
activityEngine.ensureRoot.mockClear();   // drop the connect-time call

request$.next({ activityStart: { activityType: ROOT_ACTIVITY_TYPE } });
await flushMicrotasks();

expect(activityEngine.ensureRoot).toHaveBeenCalled();      // RED today: ROOT throws before reaching ensureRoot
expect(activityEngine.startActivity).not.toHaveBeenCalled();
```

After the clear this is genuinely RED today (ROOT throws in `mapProtoActivityType` before any per-command `ensureRoot` call, so `toHaveBeenCalled()` is false) and GREEN after a1 (ROOT routes to `ensureRoot`). The same connect-time `ensureRoot` call does **not** affect the other ROOT tests — they assert on emitted `values[]`, not on `ensureRoot` call state — so only this case needs the change.

### 2. (Low / nit) Misleading comments in the CANNOT_END_ROOT tests

`:477-478` ("endActivity is called and emits COMPLETED") and `:505-506` ("stopActivity ... emits INTERRUPTED"). With the default mocks, `endActivity`/`stopActivity` resolve `null`, so the controller's `if (!session) return;` (`:411`, `:436`) short-circuits and **no** COMPLETED/INTERRUPTED frame is emitted today. The tests are still correctly RED — `expect(values).toHaveLength(1)` fails on the actual length 0, and `expect(activityEngine.endActivity).not.toHaveBeenCalled()` fails because the handler does call it — but the comment's stated mechanism is inaccurate. Optional: reword to "endActivity is called (returns null → no frame); test is RED via length 0 and the not-called assertion", or seed `endActivity.mockResolvedValue(makeSession(...))` to make the "emits COMPLETED" path literally exercised and tighten the no-COMPLETED-frame assertion. Not blocking.

### 3. (Low / nit) Idempotent test omits the planned "is sessionState, not sessionError" assertion

`:429-432` asserts only `values[0]/values[1].sessionState?.moduleSessionId === 'root-1'`. That is sufficient for the RED/GREEN contract (today both frames are `sessionError`, so `.sessionState` is `undefined` → RED; after a1 both are `sessionState` with `root-1` → GREEN). The plan also called for asserting both frames are `sessionState` rather than `sessionError`; consider adding `expect(values).toHaveLength(2)` and an explicit `sessionError` absence check to harden against a future regression that emits a stray extra frame. Optional.

### 4. (Info) Negative child-discriminator target is permanently GREEN

`:437-457`: `expect((values[0]?.sessionState as any)?.activityType).not.toBe(3)` passes whether the field is absent (today, `undefined !== 3`) or `BREATH = 1` (after a1) — it never goes RED. This is acceptable as a negative "child is not root" guard (already acknowledged in plan-review-1), and the positive ROOT test (`:363-388`) carries the actual a1-landing signal. No change required; noted so it isn't mistaken for a RED target.

---

## Non-issues verified

- `getRootId: jest.fn()` (default `undefined`) added to the engine mock has no effect on any GREEN test — the controller never calls `getRootId` pre-a1.
- The reverted `(d)` correctly expects `[ABANDONED]` then `ACTIVE(new-session)` (length 2) — matches the controller emitting ABANDONED on connect then ACTIVE from `startActivity`.
- The refreshed `setupRoutingStream` drain comment is accurate: on the default `handleReconnect → null` path no connect frame is emitted, so `values.length = 0` is a harmless no-op and the command-routing index assertions stay stable.
- `ROOT_ACTIVITY_TYPE = 3 as ActivityType` does not collide with any existing enum member (enum: UNSPECIFIED=0, BREATH=1, MEDITATION=2, UNRECOGNIZED=-1) → hits the `default` arm today as intended.

---

## Verdict

Finding 1 is a real correctness defect in the test contract: a target that is supposed to be RED-until-a1 is GREEN today, so it cannot catch a missing/incorrect a1 routing implementation — a silent hole of exactly the kind this milestone targets. It is a one-line fix (`mockClear()` after the connect flush). Findings 2–4 are nits/optional hardening. Recommend addressing Finding 1 before marking the milestone done.
