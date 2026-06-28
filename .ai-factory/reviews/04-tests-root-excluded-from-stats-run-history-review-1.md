# Code Review — 04-tests-root-excluded-from-stats-run-history

**Scope:** the three spec files changed by this milestone (the `.ai-factory/*` plan/note/review files are docs, not code, and are excluded from runtime review).
**Verdict:** correct. The implementation matches the plan and feature spec 07 exactly; behavior verified by execution, not just inspection.

## What changed (code only)
- `src/stats/stats.service.spec.ts` — adds a `finalise — root excluded` block with the stats-skip **target** (drives the real `StatsService.finalise`, asserts `repo.manager.transaction` not called) + a tag-don't-duplicate comment on the existing min-duration case.
- `src/sessions/sessions.service.spec.ts` — adds a `SessionsService.listRuns` block: a fully chainable mocked QueryBuilder, the builder-contract **target** (asserts an `andWhere` carrying an `activityType` inequality), and a row-mapping **characterization**.
- `src/realtime/services/biometric-stream-engine.service.spec.ts` — adds the bio-flush **invariant** (spy on `engine.flush`, assert it still fires on a root ABANDONED).

## Verification performed
Read all three specs in full and cross-checked against source (`stats.service.ts`, `sessions.service.ts:59-116`, `biometric-stream-engine.service.ts:135,216-226`), then ran the suite:

```
Test Suites: 2 failed, 1 passed, 3 total
Tests:       2 failed, 34 passed, 36 total
```

The **2 failures are exactly the two target tests**, and both fail for the intended reason:
- `StatsService › finalise — root excluded › should NOT write user_stats for a root session` — RED because no `ActivityType.ROOT` guard exists yet, so `finalise` runs the transaction for a 20s root event. The 20s duration correctly clears the 10s min-duration gate, so the failure genuinely reflects the *missing root guard*, not a duration short-circuit. Flips GREEN when spec 07 adds the early return at the top of `finalise`.
- `SessionsService.listRuns › should add an activityType != root filter` — RED because today `listRuns` only issues `andWhere('ms.endedAt IS NOT NULL')`; no `activityType` inequality exists. Flips GREEN when spec 07 adds `.andWhere('ms.activityType != :root', …)`.

All other cases — the bio-flush root invariant, the breath/meditation row-mapping characterization (`durationSeconds` 1200/1800 computed correctly from the entity timestamps), and the pre-existing stats streak/min-duration cases — pass. This is precisely the red/green contract the milestone defines.

## Correctness checks (no issues found)
- `jest.spyOn(engine, 'flush')` is valid — `flush` is a public method (`biometric-stream-engine.service.ts:135`). The handler's `this.buffers.delete('root-1')` after the mocked flush is a safe no-op on the `Map` for an absent key, so the test cannot throw.
- The stats target's reliance on `repo.manager.transaction` as the skip-observable matches the layer spec 07 guards at (inside `finalise`), and mirrors the existing sub-threshold case at `stats.service.spec.ts:98-106`. The worker spec is correctly left untouched (the worker forwards unconditionally — a worker-spy target would be permanently RED). This is the exact defect that plan-review-2 corrected; the implementation honors it.
- The mocked QueryBuilder returns `this` from every chained builder method, so `qb.andWhere.mock.calls` is inspectable and the destructured `([sql]) => …` matcher reads the SQL fragment correctly. The empty-result target path (`getCount→0`, `getRawAndEntities→{[],[]}`) does not throw.
- Constructors/arity correct (`new SessionsService(repo, bioRepo, streamRepo)`, `new StatsService(repo, configService)`), and `makeEvent(start, end, { activityType: 'root' as any })` uses the L2 compile-now cast since `ActivityType.ROOT` does not exist yet — the suite compiled under ts-jest, confirming no type break.
- Nothing here touches runtime app code, migrations, or schema — no migration/DI/type-mismatch/race surface to break in production.

## Observations (non-blocking, informational — do not affect the verdict)

1. **The `listRuns` target matcher couples to the `!=` operator spelling.** The assertion is `/activityType/.test(sql) && /!=/.test(sql)`. Postgres treats `<>` as an identical inequality operator, so if a future implementer writes `.andWhere('ms.activityType <> :root', …)` the test would stay RED despite a correct implementation (a false RED). This is low risk because feature note `07-exclude-root-from-stats.md:25` explicitly pins `!=`, so the test and the spec agree. If you want to harden against the equivalent spelling, broaden the regex to `/!=|<>/`. Optional.

2. **The suite is intentionally RED until spec 07 lands** (2 failing target tests). This is the designed TDD state for this milestone, not a regression — but if a CI gate blocks merges on a green suite, these two tests should be expected/tracked as known-red until Phase 57's feature task, so they aren't mistaken for breakage.

REVIEW_PASS
