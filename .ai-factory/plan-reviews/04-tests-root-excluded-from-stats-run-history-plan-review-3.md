# Plan Review 3 — Tests: root excluded from stats + run history

**Plan:** `.ai-factory/plans/04-tests-root-excluded-from-stats-run-history.md`
**Scope:** Test-only milestone (TDD, silent-bug-first). No production code, no migrations.
**Risk Level:** 🟢 Low

## Verdict

The plan is solid. Every file path, line reference, helper name, constructor signature, and
guard-placement claim was cross-checked against the live codebase and the two source notes
(`07-exclude-root-from-stats.md`, `18-test-root-stats-exclusion.md`). All match. The three
known traps for this milestone (wrong-layer assertion, mocked-QB outcome assertion, over-guard
of the bio flush) are each explicitly anticipated and correctly handled.

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md` present): WARN — none. The plan only extends
  existing co-located `*.spec.ts` files within their owning modules; no module boundaries or
  dependency directions are touched.
- **Rules** (`.ai-factory/RULES.md` present): WARN — none. The dominant rule ("NEVER use the
  non-null assertion `!`") is not triggered: test fixtures supply real `Date` objects for
  `startedAt`/`endedAt`, so no `!` is needed in the new test code. The `entity.endedAt!.getTime()`
  usage lives in existing source (`sessions.service.ts:102`), not in anything the plan adds.
- **Roadmap** (`.ai-factory/ROADMAP.md` + `ROADMAP_TESTS.md` present): WARN — none. The plan's
  "no real DB" justification for the builder-contract assertion is backed verbatim by
  `ROADMAP_TESTS.md:3` ("Instantiate via `new X(mock)` … no real DB, no real gRPC"). Milestone
  linkage to feature task `07-exclude-root-from-stats` is explicit throughout.

## Verified Claims (no issues)

- **Task 1 layer choice.** Confirmed the stats guard target belongs in `stats.service.spec.ts`,
  not the worker spec: `StatsWorker.onSessionAbandoned` (and the COMPLETED/INTERRUPTED siblings)
  forwards every event to `finalise` unconditionally (`stats.worker.ts:32-49`), so a worker-spy
  "finalise not called for root" would be permanently RED. Spec 07 places the early return at the
  top of `StatsService.finalise` (`07-exclude-root-from-stats.md:18-22`). Driving the real service
  and asserting `repo.manager.transaction` not called mirrors the existing min-duration skip at
  `stats.service.spec.ts:98-106` exactly. ✓
- **Task 1 fixtures.** `makeEvent`/`makeService` helpers exist at the cited lines
  (`stats.service.spec.ts:9-22, 82-96`). Duration of 20_000 ms (20s) clears the
  `WS_MIN_SESSION_DURATION_S=10` gate so the min-duration return does not pre-empt and mask the
  root guard. ✓
- **Task 2 bio flush.** `BiometricStreamEngine.onSessionAbandoned(payload: { sessionId })`
  confirmed at `biometric-stream-engine.service.ts:216-226`; it calls `this.flush(payload.sessionId)`
  then `buffers.delete(...)`. `jest.spyOn(engine, 'flush')` + asserting it was called with
  `'root-1'` is observable and correct. Correctly framed as an invariant (GREEN-stays-GREEN),
  not a "RED until" target — the flush path is independent of the stats guard. ✓
- **Task 3 builder contract.** `SessionsService` constructor takes three repos
  (`sessions.service.ts:50-57`); `listRuns` chains `leftJoin → addSelect → addSelect → where →
  andWhere → orderBy`, then `getCount()` and `take().skip().getRawAndEntities()`
  (`sessions.service.ts:78-97`). Today the only `andWhere` is `'ms.endedAt IS NOT NULL'`
  (line 89), so `andWhere.mock.calls.some(([sql]) => /activityType/.test(sql) && /!=/.test(sql))`
  is `false` → RED for the right reason; spec 07's `andWhere('ms.activityType != :root', …)`
  flips it GREEN. The reasoning for why outcome-only is untestable (mock ignores the clause;
  `listRuns` maps every row at `sessions.service.ts:99-113`; a JS `.filter()` would corrupt
  `total`/paging) is accurate. ✓
- **Task 3 char mapping.** Entity field set (`id`, `userId`, `startedAt`, `endedAt`,
  `activityType`) and `raw[i]` (`bs_description`/`bs_complexity` = `null`) match the mapping at
  `sessions.service.ts:99-113`; `null` raws map to `description: null` / `complexity: null`. ✓
- **Task 4.** Min-duration char already exists at `stats.service.spec.ts:98-106`; the
  "tag, don't duplicate" instruction is the correct call. ✓
- **L2 compile-now.** `ActivityType` has only `BREATH`/`MEDITATION`
  (`activity-type.enum.ts`); the `'root' as any` cast mirrors the established pattern in
  `multi-session-lifecycle.spec.ts` (e.g. lines 679, 711, 723). ✓
- **No migration / no production change** — consistent with a test-only deliverable. ✓

## Minor Observations (non-blocking)

- **Task 2 coexistence with the existing ABANDONED test.** `biometric-stream-engine.service.spec.ts:236-247`
  already has an `onSessionAbandoned` test using real `flush` (asserts `repo.save`). The new case
  uses a separate `describe` and a `flush` spy, so there is no collision — worth the implementer
  keeping them in distinct blocks as the plan already directs.
- **L3 labelling discipline.** The plan is careful to stamp `RED until spec 07-exclude-root-from-stats`
  on only the two genuine targets (Task 1 stats-skip, Task 3 builder-contract) and explicitly
  forbids stamping it on the invariants — this directly resolves the review-1 #2 contradiction and
  should be preserved as written.

## Positive Notes

- Each of the three structural traps is named, explained, and the correct assertion layer chosen —
  this is the rare test plan that pre-empts the implementer steering toward a pagination bug.
- Strong "tag, don't duplicate" hygiene against the existing characterization cases prevents spec drift.
- Findings/escalation valve (Task L4 + Notes) gives a concrete path for any newly discovered
  `@OnEvent(ABANDONED)` subscriber instead of silent workarounds.

PLAN_REVIEW_PASS
