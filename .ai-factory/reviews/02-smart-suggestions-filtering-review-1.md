## Code Review Summary

**Files Reviewed:** 10
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md** — OK. Module boundaries respected: `StatsModule` exports `StatsService`, `BreathSessionsModule` imports `StatsModule` via standard NestJS wiring. No cross-module entity or repository access. The raw SQL query on `breath_sessions` in `StatsService.finalise()` (from milestone 01) avoids importing `BreathSession` entity — acceptable trade-off already reviewed in round 1.
- **RULES.md** — OK. No `!` non-null assertions. No sensitive data logged. No unnecessary log lines added. Logging stays lean.
- **ROADMAP.md** — OK. Both milestones listed and marked complete.

### Critical Issues

None.

### Suggestions

None.

### Positive Notes

- **Module wiring** — follows the established pattern precisely. `StatsModule.exports` added `StatsService`, `BreathSessionsModule.imports` added `StatsModule`. No circular dependency: `StatsModule → AuthModule`, `BreathSessionsModule → AuthModule + StatsModule`. Verified against `AppModule` — both modules registered independently.
- **Backward compatibility** — when `maxCompletedComplexity === 0` (new user, no completed live sessions), the complexity filter is skipped entirely. Suggestions return the same results as before this change. Clean zero-default path.
- **Threshold from ConfigService** — `SUGGESTIONS_COMPLEXITY_THRESHOLD` read once in constructor with `Number()` wrapping (handles string env vars correctly) and sensible default of `50`. Same pattern as `minSessionDurationS` in `StatsService`.
- **QueryBuilder composition** — the conditional `.andWhere()` is cleanly inserted before `.orderBy('RANDOM()').limit(4).getMany()`. Parameter binding (`:maxComplexity`) prevents SQL injection.
- **Test updates** — all 4 `beforeEach` blocks in `breath-sessions.service.spec.ts` correctly updated to pass `mockStatsService` and `mockConfigService` to the new constructor signature. `stats.service.spec.ts` fixes (configService mock, manager.query mock, maxCompletedComplexity in expected object) were applied in a prior review round and verified.
- **Migration** — correct `double precision NOT NULL DEFAULT 0` with proper `up`/`down`. Entity `float` type maps correctly. Column placed logically between `longestStreak` and `lastSessionDate`.
- **Event enrichment** — all 3 emission sites in `ActivityEngine` (`endActivity`, `stopActivity`, `abandonActivity`) consistently include `activityRefId` and `activityRefType`. Optional fields on `SessionEvent` are backward-compatible.
- **EaseIn formula** — correctly smooths complexity tracking inside the existing pessimistic-write transaction. Parameterized `$1` query. Gracefully skips when `activityRefType` is not `breath_session` or when the breath session row is missing.

REVIEW_PASS
