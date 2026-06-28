# Plan Review: Exclude root from stats + run history

**Plan:** `12-exclude-root-from-stats-run-history.md`
**Files Reviewed:** 4 source/spec files cross-checked against the plan
**Risk Level:** 🟢 Low

## Verification Summary

Every concrete claim in the plan was checked against the codebase and holds:

### Task 1 — `StatsService.finalise` root early-return
- `src/stats/stats.service.ts` matches the cited line map exactly: `logger.debug` at 37-39, duration computation at 41-43, min-duration gate at 45-50.
- `ActivityType` is imported at line 7 (`../realtime/enums/activity-type.enum`). ✅
- `ROOT = 'root'` exists on the enum (`activity-type.enum.ts:4`). ✅
- Placing the guard above the min-duration gate is correct and keeps that gate's behavior untouched for non-root types.
- The service-level (not worker-level) placement is the right call and is required by the committed test. `stats.service.spec.ts:114-124` calls `svc.finalise({ activityType: 'root' })` directly and asserts `repo.manager.transaction` was NOT called — a worker guard would leave this RED. The early-return at the top of `finalise` satisfies it.
- The worker (`stats.worker.ts`) does forward every event type unconditionally across all three `@OnEvent` handlers (COMPLETED/ABANDONED/INTERRUPTED), so a single service guard covers all paths — confirmed.
- The bio-flush handler caveat is sound: `biometric-stream-engine.service.ts` is correctly excluded from this change.

### Task 2 — `SessionsService.listRuns` root exclusion
- `src/sessions/sessions.service.ts` matches the cited line map: `.andWhere('ms.endedAt IS NOT NULL')` at line 89, `.orderBy('ms.startedAt', 'DESC')` at line 90.
- `ActivityType` is imported at line 20. ✅
- The proposed clause `.andWhere('ms.activityType != :root', { root: ActivityType.ROOT })` satisfies the committed builder-contract test `sessions.service.spec.ts:325-343`, which matches `([sql]) => /activityType/.test(sql) && /!=/.test(sql)`. The SQL string `'ms.activityType != :root'` passes both regexes. ✅
- Inserting the clause before `take/skip/getCount` (it is added to `baseQuery`, which both `getCount` and `getRawAndEntities` derive from) keeps pagination/total correct — it avoids the JS-`.filter()` anti-pattern the test comment explicitly warns against.
- The characterization test at `sessions.service.spec.ts:349+` (breath/meditation rows still mapped) is unaffected since the mock QB ignores the clause.

## Context Gates
- **Architecture:** No boundary violation. Both edits stay within their owning modules (StatsModule, SessionsModule) and respect the "entities belong to their module" rule — no cross-module repository injection introduced. WARN: none.
- **Rules:** Logging stays via the existing `Logger`; no `console.*`. No migration needed — this is query/guard logic only, no schema change. The `ActivityType.ROOT` enum value already exists (added in spec 07), so no entity/migration work is in scope here. ✅
- **Roadmap:** This is the implementation counterpart to the test-spec milestones `04-tests-root-excluded-from-stats-run-history` and the `07-exclude-root-from-stats` references embedded in the committed tests. Linkage is clear and consistent with the surrounding RED-until-spec test scaffolding.

## Critical Issues
None.

## Minor Notes
- The plan correctly relies on the fact that root sessions reach `finalise` via `SessionEvents.ABANDONED` (presence-only sessions abandon on disconnect grace). No additional event-path coverage is needed — COMPLETED/INTERRUPTED for root are not expected, but the single service guard covers them anyway.
- No test additions are required by the plan (Testing: no), and none are needed — the two committed RED tests flip GREEN with exactly these two edits.

## Positive Notes
- Line-precise file references, all verified accurate against current source.
- Correctly identifies the service-vs-worker placement constraint and explains *why* via the committed test contract.
- Correctly scopes out the bio-flush handler, preventing an over-broad change that would break biometric persistence on root abandon.
- The `listRuns` approach avoids the documented pagination pitfall (JS post-filter inflating `total`).

PLAN_REVIEW_PASS
