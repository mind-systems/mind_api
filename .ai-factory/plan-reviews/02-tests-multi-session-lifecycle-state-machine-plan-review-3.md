# Plan Review — Tests: multi-session lifecycle state machine (review 3)

**Plan:** `.ai-factory/plans/02-tests-multi-session-lifecycle-state-machine.md`
**Spec:** `.ai-factory/notes/16-test-session-lifecycle-state-machine.md`
**Files Reviewed:** 1 plan + 8 source/spec files cross-checked
**Risk Level:** 🟢 Low — all four actionable findings from review 2 are incorporated; the plan is accurate against the source.

## What changed since review 2 (verified incorporated)
- **Finding 1 — Task 6 describe label** (`[RED until Phase 56]` → contradicted Context + ROADMAP): **fixed.** Line 66 now reads `describe('target — ensureRoot / linking [RED until Phase 55 — lazy-root-creation / spec 04]')`. Matches Context line 4 and ROADMAP Phase 55. ✓
- **Finding 2 — `disconnect` wrapper must forward to `handleTransportDisconnect`, not `onDisconnect`:** **fixed.** Task 1 now has a **Critical** clause (line 31) requiring `disconnect → handleTransportDisconnect` (onDisconnect + grace timer) and `reconnect → handleReconnect`; Task 4 (line 51) restates the same with the "onDisconnect alone schedules no timer" rationale. ✓
- **Finding 3 — Long-branch fixture needs `as any` to compile** (`clientTimestampMs` is typed `number`): **fixed.** Context line 16 now authorizes `{ toNumber: () => ms } as any` for both start- and end-path Long tests, with the `coerceClientTs` line ref (activity-engine.service.ts:46–50). ✓
- **Finding 4 — `rootSessionId` assertions need `as any`:** **fixed.** Task 6 line 68 now specifies `(row as any).rootSessionId` / `(state as any).rootSessionId` and explicitly forbids widening the entity or reaching for `!`. ✓
- **Finding 5 (awareness) — provisional target-API names:** acknowledged in Task 3 line 39 (names become the de-facto spec-03 contract). ✓

## Verification performed (re-confirmed against current source)
- **Store API** — `get/has/set/delete/size/startGraceTimer/cancelGraceTimer/hasPendingGraceTimer`, timers keyed by userId, post-expiry `timers.delete` (activity-session-store.service.ts:39–57). Task 2 characterization claims all map to real behavior. ✓
- **Constructor shapes** — `new ActivitySessionStore({ get: jest.fn()... } as any)` and 4-arg `new ActivityEngine(repo, store, emitter, streamEngine)` match both existing specs exactly. ✓
- **Engine surface** — `startActivity/endActivity/onDisconnect/abandonActivity/abandonStale/stopActivity/pauseActivity/unpauseActivity/getActiveSession/resumeActivity/handleReconnect/handleTransportDisconnect` all exist with assumed signatures. ✓
- **`handleTransportDisconnect`** (lines 453–465) calls `onDisconnect` (repo.update → DISCONNECTED) then `startGraceTimer(userId, () => abandonActivity(userId))` — confirms finding-2 fix is correct. ✓
- **Abandon guard** (lines 197–200): `status !== DISCONNECTED → delete + return, no save/emit` — Task 4's "abandon no-ops when already resumed" is GREEN-today. ✓
- **`coerceClientTs`** detects `typeof === 'object' && typeof toNumber === 'function'` (46–50); `endActivity` honors client end only when `clientEnd >= session.startedAt` (129–132); `startActivity` has no such guard (62) — Task 4's end-path Long gotcha is accurate. ✓
- **Enums/events** — `SessionStatus {active,disconnected,completed,abandoned,interrupted,resumed}`; `ActivityType {breath,meditation}` (no `root`); `SessionEvents.{COMPLETED,ABANDONED,INTERRUPTED}`; `StreamSessionEvent.{STARTED,ENDED,ABANDONED,PAUSED,RESUMED,INTERRUPTED}`; `MODULE_SESSION_PAUSED/UNPAUSED`. All match plan line 23. ✓
- **DTO** — `ActivityStartDto.clientTimestampMs?: number` (activity-start.dto.ts:14) confirms the cast requirement. ✓
- **Target APIs absent** — `rootSessionId`, `ensureRoot`, `addChild/getChild/listChildren/setRoot` appear nowhere in `src/` (only `activityType` on the entity). `(x as any)` access fails at runtime → red-for-the-right-reason. ✓
- **Watchdog / revoke** — `abandonStale(row.userId, row.id)` called from session-watchdog.service.ts:82; `handleSessionRevoked` exists at module-state.grpc.controller.ts:199 — Task 7's escalation surface is real. ✓
- **Jest pickup** — `*.spec.ts` under `rootDir: src` is matched; the new file runs (and its RED target blocks color the suite red until Phase 55, as the CI-tolerance bullet states). ✓
- **ROADMAP** — Phase 55 holds both `03-multi-session-store-engine` and `04-lazy-root-creation`; Phase 56 is "Proto + concurrent activities". Plan's phase attributions are correct. ✓

## Context Gates
- **ARCHITECTURE.md** — present; plan stays inside the `realtime` module's own service specs. No boundary/dependency conflict. No WARN.
- **RULES.md** — present. The `!` ban is explicitly honored (Context line 17). The `(x as any)` compile-now casts are not covered by that rule. No WARN.
- **ROADMAP.md** — present; both specs under Phase 55, consistent with the plan throughout (including the now-fixed Task 6 label). No WARN. Test-only deliverable — no `feat`/`fix` roadmap linkage owed.
- **skill-context/aif-review/SKILL.md** — not present; no project-specific review overrides.

## Critical Issues
None. The deliverable is test files only; no migration is owed (the `rootSessionId` column belongs to spec 04). The intentionally-RED target blocks are by design.

## Findings (minor — non-blocking implementer notes)

### 1. disconnect→grace→abandon requires `repo.findOne` to resolve a DISCONNECTED-status session at abandon time (minor — fixture arrangement)
`handleTransportDisconnect → onDisconnect` updates status via `repo.update` (line 174), which does **not** mutate what the `repo.findOne` mock returns. When the grace timer fires, `abandonActivity` calls `repo.findOne` and the guard at line 197 (`status !== DISCONNECTED → no save/emit, delete`) short-circuits unless the mock yields a session whose `status` is `DISCONNECTED`. So the Task 4 disconnect→grace→abandon flow must arrange `repo.findOne` to resolve `makeSession({ status: SessionStatus.DISCONNECTED })` before advancing timers — otherwise the test passes vacuously (no ABANDONED emit) and proves nothing. The existing `abandonStale` tests (activity-engine.service.spec.ts:372+) already model this mock pattern; the implementer mirroring them will likely get it right, but it is worth pinning since the plan describes the flow without naming the mock-state precondition. Not a plan defect — an implementation gotcha.

## Positive Notes
- Clean, surgical incorporation of every review-2 finding with no over-editing — the four label/cast/wrapper fixes landed precisely where flagged.
- The thin-wrapper-helper technique (`end(userId)`/`disconnect(userId)` as the single Phase-55 re-threading point) keeps a behavioral red distinguishable from a mechanical signature change — the right TDD structure for a behavior-preserving refactor.
- The compile-now `(x as any)` strategy is correctly scoped: target APIs fail at runtime (red-for-the-right-reason) without blocking the rest of the suite from compiling.
- Line references in the plan (`activity-engine.service.ts:46–50`, `128–132`, `197–200`, `453–465`) all check out against the actual file — the author verified rather than guessed.
- Task 7's findings-pass correctly routes silent multi-session gaps (disconnect-moves-ALL, reconnect-resumes-ALL, revoke-stops-every-child+root) into the spec's Findings section without editing the feature specs' behavior — exactly the right escalation channel.

## Verdict
All actionable findings from reviews 1 and 2 are resolved, and the plan is accurate against the current source. The sole remaining item is a minor fixture-arrangement gotcha (finding 1) that does not require a plan change. Passing.

PLAN_REVIEW_PASS
