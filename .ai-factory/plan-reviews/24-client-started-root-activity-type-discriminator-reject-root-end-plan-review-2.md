# Plan Review 2: Client-started root + `activity_type` discriminator + reject root end

**Plan:** `.ai-factory/plans/24-client-started-root-activity-type-discriminator-reject-root-end.md`
**Spec:** `.ai-factory/notes/34-deliver-root-id-on-connect.md`
**Risk Level:** 🟢 Low — both blocking issues from review-1 are resolved; all codebase claims re-verified.

## Summary

This is the second-iteration plan. Both critical issues flagged in review-1 have been folded directly into the task text, and every file/line reference, type contract, and committed-test target has been re-verified against the current tree. The plan is implementable as written and keeps the already-committed a1 acceptance suite green.

Re-verification of the two blocking fixes:

1. **Total reverse mapper (review-1 Critical 1).** Task 3 now mandates `mapInternalActivityType` be **total** — `default → ProtoActivityType.ACTIVITY_TYPE_UNSPECIFIED`, explicitly "do NOT `throw`", with an optional `void _exhaustive` compile-only guard. Task 5 sources the start-frame discriminator from the **local mapped `activityType` variable** (`mapInternalActivityType(activityType)`), not `session.activityType`. This is exactly what the committed ROOT-start test requires: `ensureRoot` mock returns `makeSession({ id: 'root-1' })` (no `activityType` field, spec `:24-26`), and the test asserts `(sessionState as any).activityType).toBe(3)` (spec `:385`). Resolved.

2. **Required-field compile constraint (review-1 Critical 2).** Task 7 now stamps `activityType: ProtoActivityType.ACTIVITY_TYPE_UNSPECIFIED` on the reconnect ABANDONED frame and explicitly states "Do NOT leave it unset — the field is required, so an unset literal is a compile error." Every other `sessionState` literal (RESUMED, COMPLETED, INTERRUPTED, pause, resume) gets an `activityType` via the total mapper. Resolved.

3. **Cache-hit ordering nit (review-1 minor).** Task 5 now instructs moving the `mapProtoActivityType` call **above** the idempotency lookup so the cache-hit frame (`:347-355`) can stamp the required field, with the correct note that validating type before the dedup short-circuit is harmless. Resolved.

## Codebase verification

- `mapProtoActivityType` at `:41-64`, `handleActivityStart` `:315-393`, rate-limit `:320-334`, dedup `:338-356`/`:379-382`, start success `:384-389`, cache-hit `:347-355`, try/catch `:359-370`, `handleActivityEnd` `:395-419`, `handleActivityStop` `:421-446`, reconnect RESUMED `:138-144`, ABANDONED `:131-136`, COMPLETED `:412-417`, INTERRUPTED `:437-442`, pause `:464-470`, resume `:499-505`, connect-time `ensureRoot` `:154` — **all line references confirmed accurate**.
- `proto/module_state.proto`: `ActivityType` `:13-17` (UNSPECIFIED=0, BREATH=1, MEDITATION=2 → next free `ROOT=3` ✓); `StateEvent` `:81-85` (fields 1,2,3 → next free `activity_type=4` ✓); `ActivityStartCmd.activity_type` already field 1 (`:39`) — no request-shape change. Confirmed.
- `InternalActivityType.ROOT = 'root'` exists (`enums/activity-type.enum.ts:4`). Confirmed.
- `ensureRoot` returns `ModuleSession` with `activityType=ROOT`, `rootSessionId=null`, idempotent by userId (`activity-engine.service.ts:73-118`). Confirmed.
- `startActivity` stamps `rootSessionId = getRootId(userId)` (`:124,:134-136`) — correctly avoided for root. Confirmed.
- Engine rejects root internally: `endActivity :189-197`, `stopActivity :397-404` (plan says `:396-404` — off by one, immaterial). Confirmed double-defense rationale.
- `ActivityEngine` has **no** public `getRootId` today (only internal `this.activitySessionStore.getRootId`) — Task 4's new delegate is genuinely needed. Confirmed.
- `activity-session-store.service.ts:79` `getRootId(userId): string | null` — Task 4's `string | null` return type matches the store (overriding the spec note's `undefined`). Confirmed.
- Committed spec mocks: `getRootId: jest.fn()` is present on the engine mock (`:40`); reject-end test sets `getRootId.mockReturnValue('root-1')` and asserts `CANNOT_END_ROOT` + `endActivity` not called (`:464-491`); stop counterpart `:493-519`. `ROOT_ACTIVITY_TYPE = 3 as ActivityType` (`:361`). ROOT-start `:363-388` and child-not-3 `:442-459` align with the plan's discriminator approach. Confirmed.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** PASS. Change stays within the `realtime` module boundary; respects `proto/` as single source of truth; controller reaches the store only via the new `ActivityEngine` delegate (no cross-module internal import).
- **Rules (`.ai-factory/RULES.md`):** PASS. No non-null assertion (`!`) introduced — the root-id comparison uses `===` against `getRootId` (`string | null`) with no force-unwrap. Logging stays ID-only/minimal. The `@Payload()` + `@GrpcCurrentUser()` rule is untouched (no signature changes to gRPC methods).
- **Roadmap (`.ai-factory/ROADMAP.md`):** PASS. Linked to Phase a1; the corrective test task (note 37 / committed `module-state.grpc.controller.spec.ts`) encodes the GREEN targets this plan turns green.

## Minor Notes (non-blocking)

- **Commit messages** conform to project convention (sentence case, imperative, no `feat:`/`fix:` prefix). Good.
- **Consumer regen (informational):** this edits the single-source-of-truth proto; `mind_mobile` must copy + regenerate as a separate follow-up (handoff 12). The plan correctly scopes that out — just confirming it is tracked, not forgotten.
- **`stopActivity` line ref** in Task 6 reads `:396-404` vs the actual `:397-404` — cosmetic, no action needed.

## Verdict

The plan is solid. Both review-1 blockers are resolved in the task text, every codebase and committed-test claim re-verified, and the proto/controller changes are minimal, additive, and correctly sequenced. No migration is needed. Ready to implement.

PLAN_REVIEW_PASS
