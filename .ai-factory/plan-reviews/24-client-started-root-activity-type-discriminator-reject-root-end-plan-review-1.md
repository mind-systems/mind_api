# Plan Review: Client-started root + `activity_type` discriminator + reject root end

**Plan:** `.ai-factory/plans/24-client-started-root-activity-type-discriminator-reject-root-end.md`
**Spec:** `.ai-factory/notes/34-deliver-root-id-on-connect.md`
**Risk Level:** 🔴 High — two issues will leave the build/test suite red as written.

## Summary

The plan's intent, sequencing, and most of its codebase claims are accurate: line references (`mapProtoActivityType :41-64`, `handleActivityStart :315-393`, `ensureRoot :73-118`, `getRootId` on the store) all check out; `InternalActivityType.ROOT='root'` exists; `ensureRoot` already returns `activityType=ROOT, rootSessionId=null` and is idempotent; the engine already rejects root for end/stop/pause/resume internally; no migration is needed. The proto change is correctly scoped (additive, no `is_root`, no request-shape change).

However, the committed spec `src/realtime/module-state.grpc.controller.spec.ts` (already on disk, the corrective tests from ROADMAP task `:73`, currently RED for a1) encodes the exact GREEN targets this plan must satisfy. Two concrete instructions in Tasks 5/7 contradict both that test file and the regenerated proto type, and will produce a red build. The plan's "Testing: no" setting does **not** make this safe — these tests are already committed and will run.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** PASS. The change stays within the `realtime` module boundary and respects "`proto/` is the single source of truth." No cross-module internal imports introduced.
- **Rules (`.ai-factory/RULES.md`):** PASS. No non-null assertion (`!`) is introduced — the root-id comparison uses `=== this.activityEngine.getRootId(userId)` with no force-unwrap. Logging stays minimal/ID-only. gRPC `@Payload()`/`@GrpcCurrentUser()` rule untouched.
- **Roadmap (`.ai-factory/ROADMAP.md`):** PASS. Directly linked to Phase a1 task `:84` ("Client-started root + `activity_type` discriminator + reject root end"), same Spec tag. The corrective test task `:73` is already `[x]` — its targets are what this plan turns GREEN.

## Critical Issues

### 1. `mapInternalActivityType(session.activityType)` throws on the committed test mocks (and is fragile in general) — Tasks 5 & 7

The plan tells the implementer to stamp the discriminator by reading the type off the returned session/state object:
- Task 5: `activityType: mapInternalActivityType(session.activityType)` on the start success frame.
- Task 7: `result.activityType` (reconnect RESUMED), `session.activityType` (end/stop), `state.activityType` (pause/resume).

Combined with Task 3's "same exhaustive `never` guard pattern" (i.e. the reverse mapper **throws** on anything it doesn't recognize), this breaks the committed tests, because every relevant mock returns a session/state **without** an `activityType` field:

- `makeSession(overrides?: Partial<{ id: string }>)` returns `{ id, ...overrides }` — **no `activityType`** (spec `:24-26`).
- `makeActivityState(...)` returns `{ sessionId, isPaused, ... }` — **no `activityType`** (spec `~:1`/pause-resume helper).

So `mapInternalActivityType(undefined)` hits the `never` default and throws → `routeCommand`'s catch emits `INTERNAL_ERROR` instead of the expected frame. Concretely, these committed cases go RED:

- ROOT start `:363-388` — asserts `(sessionState as any).activityType).toBe(3)`. `ensureRoot` mock = `makeSession({ id: 'root-1' })` → `activityType` undefined → throws → no `sessionState` → **fails** (and `toBe(3)` errors on undefined).
- End COMPLETED `:933-944`, Stop INTERRUPTED `:985-1000` — assert `status`/`moduleSessionId`; the throw replaces the frame with `INTERNAL_ERROR` → **fail**.
- Pause `:1044-1056`, Resume `:1113-1125` — same throw via `state.activityType` undefined → **fail**.
- Reconnect RESUMED `:153-176`, `:178-196` — `handleReconnect` mock = `makeSession(...)` → `result.activityType` undefined → throws → expected `RESUMED`/`moduleSessionId` frame becomes `INTERNAL_ERROR` → **fail**.

Note this is a *test-mock* gap, not a production gap — the real `ensureRoot`/`endActivity`/`stopActivity`/`pause`/`resume` all populate `activityType`. But the committed unit tests are the acceptance gate for a1, so the implementation must keep them green.

**Fix (two parts):**
1. For the **start** success frame, derive the discriminator from the **local mapped `activityType` variable** the controller already computed (`mapProtoActivityType(cmd.activityType)`), not from `session.activityType`. In the ROOT branch that variable is `InternalActivityType.ROOT`, so `mapInternalActivityType(activityType)` yields `3` even though the mocked `ensureRoot` session carries no type. This is also more correct — the discriminator should reflect what the controller resolved, not rely on the engine echoing it back.
2. Make `mapInternalActivityType` **total** instead of throwing: `default → ProtoActivityType.ACTIVITY_TYPE_UNSPECIFIED`. Then the end/stop/pause/resume/reconnect frames (which legitimately may lack a type in a mock, and must satisfy the required-field constraint in Issue 2) emit `0` rather than crashing. The committed tests for those paths assert only `status`/`moduleSessionId`/`isPaused`, so `UNSPECIFIED` is acceptable; the negative child guard `:442-461` only asserts `!== 3`. (If a forward `never`-style guard is still wanted for safety, keep it as a `void _exhaustive` compile-time check but do **not** throw at runtime.)

### 2. After regeneration `StateEvent.activityType` is a **required** field — Task 7's "leave ABANDONED unset" is a compile error

ts-proto emits non-optional proto3 scalar/enum fields as **required** interface properties. The current generated `StateEvent` already proves this:

```ts
export interface StateEvent {
  moduleSessionId: string;     // required
  status: ActivityStatus;      // required
  isPaused?: boolean | undefined;
}
```

Adding `ActivityType activity_type = 4;` regenerates to `activityType: ActivityType;` — **required**, like `status`. Therefore every `sessionState: { ... }` object literal in the controller must include `activityType`, or `npm run build` fails with TS2741 (missing property).

Task 7 explicitly says for the reconnect **ABANDONED** frame (`:131-136`): "Prefer leaving unset … note this in the code comment." That literal would then be missing a required property → **compile error**.

**Fix:** stamp `activityType: ProtoActivityType.ACTIVITY_TYPE_UNSPECIFIED` on the ABANDONED frame (the `clientSessionId` path genuinely has no type to assert, and `UNSPECIFIED=0` is exactly the sentinel for that). The committed ABANDONED test `:275-313` uses `toMatchObject`, so an extra `activityType: 0` does not break it. Update Task 7's guidance accordingly — "leave unset" is not an option once the field is required.

## Minor Issues / Nits

- **Task 5, idempotency cache-hit frame (`:347-355`):** this emission sits **before** `mapProtoActivityType` runs (`:358-360`), so the local mapped `activityType` is not yet available there, yet the frame now needs a (required) `activityType`. The implementer must either (a) move the `mapProtoActivityType` call above the idempotency lookup, or (b) compute the discriminator inline from `cmd.activityType` for that frame. Option (a) slightly changes ordering (type-validation now precedes the dedup short-circuit), which is harmless since a cached entry implies a previously-valid type — but call it out so the implementer doesn't leave the required field unset. The committed ROOT-idempotency test `:414-440` does not set `clientActivityId`, so this path is not directly covered, but the build still must compile.

- **Task 4 return type:** correctly aligned to the store (`string | null`), overriding the spec note's `string | undefined`. Good — the comparison `resolved.sessionId (string | undefined) === getRootId (string | null)` is sound: when there is no explicit `sessionId` and zero children, `resolved.sessionId` is `undefined`, which never equals a `string` root id or `null`, so no false `CANNOT_END_ROOT`. Verified against `resolveTargetSession :282-313`.

- **Redundant-but-harmless guard:** the engine already rejects root in `endActivity :189-197` and `stopActivity :396-404` (returns `null` → controller emits nothing). The new controller-level guard (Task 6) is what upgrades that silent no-op into an explicit `CANNOT_END_ROOT` frame, which is the intended behavior and what test `:464-481` asserts. Worth a one-line code comment noting the double guard is intentional (controller = client-facing error; engine = defense-in-depth).

- **Consumer regen (informational, not a defect):** this edits `proto/module_state.proto`, the single source of truth. `mind_mobile` must copy + regenerate (handoff 12). The plan correctly scopes that out to a separate follow-up; just confirming it is tracked, not forgotten.

## Positive Notes

- Correctly routes the root through `ensureRoot` (not `startActivity`), with an accurate rationale (`startActivity` would stamp a non-null `rootSessionId`). Verified at `activity-engine.service.ts :124-136` vs `:73-118`.
- Keeps the rate-limit and `clientActivityId` dedup guards on both paths — matches the spec and avoids a root-start bypass.
- Proto change is minimal and additive; field numbers `ROOT=3` and `activity_type=4` are genuinely the next free slots; no migration is correctly identified.
- The "no unsolicited connect frame" decision (leave `:154` discarded) is preserved and matches the committed `:198`/`:300-301` "no frame on fresh connect" tests.
- Reverse-mapper-once, used everywhere approach is the right shape; only its totality (Issue 1) and the required-field implication (Issue 2) need adjusting.

## Verdict

Two blocking issues (Critical 1 & 2) will leave the build red and the already-committed a1 acceptance tests failing. Fix the discriminator sourcing (use the local mapped type for the start frame; make `mapInternalActivityType` total) and stamp `ACTIVITY_TYPE_UNSPECIFIED` on frames lacking a concrete type (notably ABANDONED) so the required field compiles. Address the Task 5 cache-hit ordering nit while doing so. After these adjustments the plan is sound.
