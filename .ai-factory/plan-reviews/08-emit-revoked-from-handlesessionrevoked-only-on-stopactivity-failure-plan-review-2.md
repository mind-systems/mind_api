# Plan Review 2 — Milestone 08: Emit `REVOKED` from `handleSessionRevoked` only on `stopActivity` failure

**Plan file:** `.ai-factory/plans/08-emit-revoked-from-handlesessionrevoked-only-on-stopactivity-failure.md`
**Risk Level:** 🟢 Low
**Verdict:** Solid. Aligned with the design note, line numbers are accurate, no missing steps.

## Context Gates

- **Architecture:** WARN — no `.ai-factory/ARCHITECTURE.md` present at the repo root. Plan keeps within the existing modular-monolith conventions (controller depends only on already-imported `@nestjs/event-emitter`), so no boundary violation.
- **Rules:** PASS — plan explicitly forbids `!` (project rule), keeps logging lean (project rule), does not invent migrations, does not touch entities owned by other modules.
- **Roadmap:** PASS — milestone is part of note `04-session-revoke-flush-fix.md` two-step rollout (07 added enum, 08 wires emit, the engine listener is a downstream milestone). Plan accurately calls out that emit alone produces no observable flush — that's the intentional half-rollout.

## Codebase Verification

- `src/realtime/module-state.grpc.controller.ts:9` — `import { OnEvent } from '@nestjs/event-emitter';` ✓ plan correctly proposes merging `EventEmitter2` into this single line.
- `src/realtime/module-state.grpc.controller.ts:52-66` — constructor signature matches plan (`activityEngine`, `rateLimiterService`, `activeStreamRegistry`, `configService` untyped). Appending `EventEmitter2` at position 5 is the lowest-churn placement. ✓
- `src/realtime/module-state.grpc.controller.ts:165-176` — `handleSessionRevoked` body matches the plan's description verbatim. ✓
- `src/realtime/events/session.events.ts:5` — `REVOKED: 'session.revoked'` exists (milestone 07 deliverable). ✓
- `src/realtime/services/activity-engine.service.ts:312-314` — `getActiveSession(userId): ActivityState | undefined` matches plan. ✓
- `src/realtime/interfaces/activity-state.interface.ts:4` — `sessionId: string` confirms the chained access `?.sessionId ?? null` resolves to `string | null`. ✓
- `src/realtime/services/activity-engine.service.ts:236` — happy-path `INTERRUPTED` emit is still inside `stopActivity` (only fires when the function reaches that line, i.e. no throw and a real DB row). This confirms the plan's race-avoidance rationale. ✓
- `src/app.module.ts:30` — `EventEmitterModule.forRoot()` is registered globally, so DI for `EventEmitter2` will resolve without modifying `RealtimeModule`. ✓
- `src/realtime/realtime.module.ts` — no changes needed; controller is already declared, and `EventEmitterModule` is global. ✓
- Spec line references in plan are correct:
  - `spec.ts:56-60` is the `makeConfigService` helper — right anchor for inserting `makeEventEmitter`. ✓
  - `spec.ts:76-89` constructs the controller positionally with four args — extending to five matches the plan. ✓
  - `spec.ts:475-513` `handleSessionRevoked` describe block — assertions remain valid because `makeActivityEngine` defaults `getActiveSession` to `undefined`, so `sessionId === null` and the catch-block emit is guarded out (no `undefined.emit` crash). ✓
- `grep "new ModuleStateGrpcController"` — only `module-state.grpc.controller.spec.ts` instantiates positionally; no other call site needs touching. NestJS DI handles the production wire-up automatically. ✓

## Critical Issues

None.

## Minor Observations (non-blocking)

1. **`SessionRevokedPayload` is imported as a type-only symbol** (`import type` at line 29). The plan does not need to change this import — `handleSessionRevoked(payload: SessionRevokedPayload)` is a pure type position. Worth noting only to confirm no surprise from the existing `import type`.
2. **Edge case completeness.** The plan's "stopActivity returns null without throwing" branch is explicit (no emit) and matches note 04 §"Edge case." If `stopActivity` returns a non-null session on the happy path, `getActiveSession` was non-null too (state was present), so the pre-resolved `sessionId` is correct — but the emit still doesn't fire because we exited the `try` cleanly. That double-coverage is structurally enforced by the order of operations the plan prescribes.
3. **Spec helper placement.** The plan asks for `makeEventEmitter` "around `spec.ts:56-60`, after `makeConfigService`." That sits between two existing helpers; either placement (just before or just after `makeConfigService`) is fine — the plan's "after" is consistent with the constructor-argument order. No correction needed.
4. **No new tests are required.** Plan setting is `Testing: no`, and the existing tests at `spec.ts:475-513` will keep covering the same behavioral contract. New positive-emit / no-emit assertions belong in a follow-up `ROADMAP_TESTS.md` entry, as the plan explicitly states. ✓

## Positive Notes

- Plan calls out the exact race condition that motivates "emit only inside catch" (double `sampleRepo.save` from a second `slice()` of the still-non-empty buffer) and cites the relevant `stream-engine.service.ts` lines via note 04.
- Plan correctly uses `?? null` rather than `!` (matches project rule against non-null assertions).
- Plan is surgically scoped — one production file, one spec file, no engine/listener changes, no migration, no module rewiring.
- Plan anticipates the failure mode where `eventEmitter` would silently be `undefined` if the spec weren't updated, and provides the fix preemptively.
- Plan acknowledges the milestone produces no observable behavior on its own and explains why (intentional staging with the engine-side listener milestone).

PLAN_REVIEW_PASS
