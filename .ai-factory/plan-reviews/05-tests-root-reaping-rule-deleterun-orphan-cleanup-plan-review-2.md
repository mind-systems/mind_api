# Plan Review 2: Tests — root reaping rule + deleteRun orphan cleanup

**Plan:** `.ai-factory/plans/05-tests-root-reaping-rule-deleterun-orphan-cleanup.md`
**Spec note:** `.ai-factory/notes/19-test-root-reaping-deleterun.md`
**Files Reviewed:** 8 (plan, prior review-1, `session-watchdog.service.ts` + spec, `sessions.service.ts` + spec, `activity-type.enum.ts`, `realtime-config.ts`, `biometric-stream-engine.service.ts`, `module-session.entity.ts`)
**Risk Level:** 🟢 Low

## Summary

This is the revised plan after review-1. The three issues from review-1 are now explicitly closed by the new **Pinned cross-spec decisions** block (P1–P4) and the Phase 0 escalation task. Every concrete code reference re-checked against current source still resolves correctly. This is a test-only milestone — no production code, no migrations, no security surface.

## Verification of plan claims against the codebase (re-checked)

- `SessionWatchdogService` 4-arg ctor `(repo, activityEngine, activeStreamRegistry, configService)` — confirmed (`session-watchdog.service.ts:25-31`).
- `sweep()` is the only public sweep method; stale query `status In([ACTIVE, DISCONNECTED]) + lastActivityAt LessThan(threshold)`, `hasLiveSubscriber` skip at line 71, `abandonStale` + `closeAll` loop at lines 82-83 — confirmed (`:56-91`). No root logic exists yet → P1's separate `sweepEmptyRoots()` is genuinely absent → target cases are RED-for-feature-absent.
- The protected query-construction block `session-watchdog.service.spec.ts:52-110` asserts `expect(repo.find).toHaveBeenCalledTimes(1)` (line 61) and the empty-result no-op (lines 104-110) — confirmed verbatim. P2's claim that a separate `sweepEmptyRoots()` leaves this block untouched is sound: the `sweep()`-only chars never invoke the root path.
- Existing watchdog spec uses `jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)` (line 54), not fake timers, and `configService.get` mock branches on key (lines 79-102 show the `WS_SESSION_MAX_IDLE_MS` precedent the plan mirrors) — confirmed. The `repo` mock is currently `{ find: jest.Mock }`; adding `count`/`delete` (Task 2) is the right delta.
- `makeSession` overrides param is `Partial<Pick<ModuleSession, 'id'|'userId'|'status'|'lastActivityAt'>>`, so a separate `makeRoot()` helper using `activityType: 'root' as any` / `rootSessionId: null as any` is necessary (the typed Pick would reject those fields) — the plan correctly introduces a new helper rather than overloading `makeSession`.
- `SessionsService` 3-arg ctor `(moduleSessionRepo, bioSampleRepo, streamSampleRepo)` — confirmed (used in spec at lines 40-44).
- `deleteRun`: ownership check → `endedAt == null → ConflictException` → single `moduleSessionRepo.delete({ id: sessionId })` at line 144, no sibling/root logic — confirmed (`:137-146`). `session.rootSessionId` is read from the `findOne` result, so the fixture-driven `rootSessionId: 'root-id' as any` correctly feeds spec 15's future branch.
- `sessions.service.spec.ts` `moduleSessionRepo` mock has `findOne/delete/createQueryBuilder` (lines 30-34); adding `count` (Task 4) is the right delta. `makeSession` overrides are `Partial<ModuleSession>`, so the `as any` cast guidance for `rootSessionId` (Issue 3 fix) is correct and necessary.
- `ActivityType` enum has only `BREATH`/`MEDITATION` — no `ROOT` — confirmed. `'root' as any` compile-now approach correct.
- `ModuleSession` entity has no `rootSessionId` column (only `activityType` at line 24) — confirmed.
- `RealtimeConfig.EMPTY_ROOT_TTL_MS = 'WS_EMPTY_ROOT_TTL_MS'` declared — confirmed (`realtime-config.ts:14`).
- Bio flush updates `lastActivityAt` via `moduleSessionRepo.update({ id }, { lastActivityAt: now })` (`biometric-stream-engine.service.ts:183-184`) — confirmed; the "fresh root" case correctly grounds on this.
- Spec note `19-test-root-reaping-deleterun.md` exists — confirmed (Phase 0 Task 1 target is real).

## Resolution of review-1 issues

- **Issue 1 (entrypoint not pinned)** → **resolved by P1.** Root reaping is pinned to a separate public `sweepEmptyRoots()` on `SessionWatchdogService`, scheduled by the cron alongside `sweep()`, driven in tests via `(watchdog as any).sweepEmptyRoots()`. This eliminates both failure modes: the test never drives a `sweep()` that won't call the feature, and never guesses a private name → no `TypeError` harness artifact. Escalated in Phase 0 before authoring.
- **Issue 2 (query-construction chars unprotected)** → **resolved by P2.** The `:52-110` block is explicitly added to the protected-characterization set, and P1's separate-method design provably keeps `toHaveBeenCalledTimes(1)` intact because the root path lives outside `sweep()`. Task 2/3/5 all restate the "do not modify `:52-110`" constraint.
- **Issue 3 (rootSessionId fixture typing)** → **resolved.** Task 4 explicitly requires the `as any` cast for `rootSessionId` in `sessions.service.spec.ts`, and Task 2 specifies the watchdog `makeRoot()` casts.

## Context Gates

- **Architecture (`ARCHITECTURE.md`)** — PASS. Specs stay within their owning modules (watchdog under `realtime/`, sessions under `sessions/`); no cross-module internals reached. Consistent with the modular-monolith boundary rule.
- **Rules (`RULES.md`)** — PASS. No non-null assertions (`!`) introduced — the plan uses `as any` casts as the codebase already does (e.g. `endedAt: null as any` at spec line 116). No sensitive-data logging (logging set to "minimal", and these are tests). The `@Payload()`/`@GrpcCurrentUser()` rule is irrelevant to this milestone.
- **Roadmap (`ROADMAP_TESTS.md`)** — WARN (non-blocking, carried from review-1). The test roadmap does not enumerate milestone 05 or feature specs `08-janitor-empty-roots` / `15-deleterun-orphan-root-cleanup`, so milestone linkage cannot be verified there. The plan already records this in its Notes and defers it to the roadmap owner. Out of scope for test authoring.

## Critical Issues

None.

## Minor Issues (non-blocking — escalation valve already covers them)

### 1. P3's "delete **and/or** abandonStale" leaves the root-reap assertion mechanism slightly under-pinned

P3 says `sweepEmptyRoots()` reaps "per-root via `moduleSessionRepo.delete({ id: root.id })` **and/or** `activityEngine.abandonStale(root.userId, root.id)`", and Task 3's first case asserts "the per-root `repo.delete({ id: root.id })` / `abandonStale(...)` outcome fired." These are semantically different operations (`delete` removes the row; `abandonStale` transitions state), and spec 08 may implement only one. If the authored assertion requires **both** to fire, a single-mechanism feature would leave the case permanently RED — the exact failure mode review-1 Issue 1 warned about, now at mechanism granularity rather than entrypoint granularity.

Recommendation (cheap): author the reap assertion as an **OR over the two observable effects** for that specific root (delete OR abandonStale targeting `root.id`/`root.userId`), or pin the single mechanism in the note's **Findings** during Phase 0. The plan's existing escalation valve (Task 5 appends mechanism mismatches to Findings before the feature task) does cover this, so it is not blocking — but resolving it at authoring time avoids a wrong-reason RED. Note the symmetric "NOT reaped" cases are safe either way: asserting neither effect fired for that root is robust to the choice.

### 2. `repo` mock type annotation will need widening

Task 2 adds `count`/`delete` to the watchdog `repo` mock, but the declared type is `let repo: { find: jest.Mock }` (spec line 26). The authoring step must widen this annotation (e.g. add `count: jest.Mock; delete: jest.Mock`) or the additions won't type-check. Trivial mechanical detail, flagged only so the implementer doesn't trip on it.

## Positive Notes

- The P1–P4 block is a model resolution of a cross-spec TDD contract: it pins the *entrypoint* (P1), protects the *exact characterization assertions at risk* (P2), and pins the *mock-observable mechanism* (P3/P4) with an explicit carve-out for the bulk-delete alternative — each tied to a real failure mode and a real code site.
- Every line/API reference still resolves against current source — the plan did not drift from the codebase between revisions.
- The deleteRun "count siblings AFTER deleting the child" case is correctly framed as observable via jest `invocationCallOrder`, with no transaction-internal assertions — consistent with the note's Gotchas.
- The characterization-vs-target labelling by spec name (`[RED until spec 08-janitor-empty-roots]` / `[RED until spec 15-deleterun-orphan-root-cleanup]`) and the "RED-for-the-right-reason" verification in Task 5 keep the TDD signal honest.

## Recommendation

The plan is solid and ready to implement. Review-1's blocking issues are fully resolved. The two minor items above are non-blocking and already covered by the plan's Phase 0 escalation / Findings valve — addressing minor item 1 at authoring time (assert reap as an OR, or pin the single mechanism in Findings) is the one worthwhile refinement.

PLAN_REVIEW_PASS
