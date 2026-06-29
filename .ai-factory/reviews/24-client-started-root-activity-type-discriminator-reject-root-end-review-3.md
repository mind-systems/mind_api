# Code Review (round 3): Client-started root + `activity_type` discriminator + reject root end

**Plan:** `.ai-factory/plans/24-client-started-root-activity-type-discriminator-reject-root-end.md`
**Scope reviewed:** `proto/module_state.proto`, `proto/generated/module_state.ts`, `src/realtime/module-state.grpc.controller.ts`, `src/realtime/services/activity-engine.service.ts`, `src/realtime/concurrency-idempotency.spec.ts`
**Result:** ✅ All prior findings resolved. No new findings.

## Resolution of prior findings

- **Review-1 (spurious `CANNOT_END_ROOT` on undefined sessionId)** — fixed in round 2; both guards now include `resolved.sessionId !== undefined` (`module-state.grpc.controller.ts:449`, `:490`). Still correct.
- **Review-2 (regression: `concurrency-idempotency.spec.ts` green→red because its engine mock lacked `getRootId`)** — fixed exactly as recommended:
  ```diff
  +    getRootId: jest.fn().mockReturnValue(null),
  ```
  added to `makeActivityEngine` (`concurrency-idempotency.spec.ts:79`). Returning `null` (the store's real "no root" value) keeps `'session-A' === null` false, so the end/stop guard no longer throws and the routing test passes.

## Verification performed

- `npx tsc --noEmit` — no errors in any changed file (the unrelated `biometric-stream-engine.service.spec.ts` errors are pre-existing, outside this diff).
- `npx jest src/realtime/module-state.grpc.controller.spec.ts` → **66 passed / 66** (a1 acceptance suite fully green).
- `npx jest src/realtime/concurrency-idempotency.spec.ts` → **11 passed / 11** (regression resolved).
- `npx jest src/realtime` (whole module) → **356 passed, 5 failed**. The 5 failures are all pre-existing intentional future-spec targets, confirmed in review-2 to fail identically at HEAD with the source reverted:
  - `module-instruction-stream.grpc.controller.spec.ts` — 3 × `ownership routing (target, RED until note 36)`.
  - `module-biometric-stream.grpc.controller.spec.ts` — 2 × `[RED until note 35]`.
  None are caused by this change.

## Correctness recap (unchanged from prior rounds, re-confirmed)

- Proto change additive and correctly regenerated: `ActivityType.ROOT = 3`, `StateEvent.activityType: ActivityType` (required) present in `proto/generated/module_state.ts`. Field numbers are the next free slots; no `is_root`; no request-shape change.
- `mapInternalActivityType` is total (`default → ACTIVITY_TYPE_UNSPECIFIED`, no throw); the start-frame discriminator derives from the locally mapped `activityType` (not the engine echo); cache-hit emission carries the required field after the reordered `mapProtoActivityType` call.
- ROOT starts routed through `ensureRoot` (idempotent, `rootSessionId=null`), never `startActivity`; rate-limit and `clientActivityId` dedup retained on both paths.
- Root end/stop rejected with `CANNOT_END_ROOT` only when an actual resolved session equals the live root id; engine-level rejection remains as defense-in-depth.
- `ActivityEngine.getRootId` delegate returns `string | null` from the store — matches the contract.
- No new migration required (`activityType=root` pre-exists). No non-null assertions; logging stays ID-only; change stays within the realtime module boundary.
- Consumer regen (mind_mobile copy + regenerate, handoff 12) correctly scoped out to a follow-up.

The implementation is correct, type-checks cleanly, and leaves the realtime suite with only the pre-existing note-35/note-36 future-spec reds.

REVIEW_PASS
