## Code Review Summary

**Files Reviewed:** 6
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md** — WARN: `StatsService` uses a raw SQL query on `breath_sessions` table to avoid importing the entity from `BreathSessionsModule`. This is an intentional trade-off noted in the plan to respect module boundaries. Acceptable given the alternative (cross-module entity import) would be a stricter architecture violation.
- **RULES.md** — OK. No `!` non-null assertions. No sensitive data logged. No unnecessary log lines added.
- **ROADMAP.md** — OK. Milestone is listed and marked complete.

### Critical Issues

**1. `stats.service.spec.ts:254` — `getStats` test will fail once pre-existing issue is fixed**

The test uses `toEqual()` (exact match). `getStats()` now returns `maxCompletedComplexity: 0` in both branches, but the expected object doesn't include it:

```typescript
// Line 254
expect(stats).toEqual({
  totalSessions: 0,
  totalDurationSeconds: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastSessionDate: null,
  // missing: maxCompletedComplexity: 0
});
```

Currently masked by a **pre-existing** issue: `makeService()` at line 85 passes only 1 argument (`repo`) but `StatsService` requires 2 (`repo`, `configService`). All 8 tests in this file crash with `TypeError: Cannot read properties of undefined (reading 'get')` before reaching any assertion. This predates this changeset.

**Fix both together:**

```typescript
function makeService(existingRow: Record<string, unknown> | null = null) {
  const repo = makeRepo(existingRow);
  const configService = { get: jest.fn().mockReturnValue(10) };
  const svc = new StatsService(repo as any, configService as any);
  return { service: svc, repo };
}
```

And add `maxCompletedComplexity: 0` to the expected object in the `getStats` test.

### Suggestions

None.

### Positive Notes

- **Migration** — correct SQL with `double precision NOT NULL DEFAULT 0`. Proper `up`/`down` pair. Column type matches entity (`float` → `double precision`). Existing rows are backfilled to `0`.
- **Module boundaries** — raw query on `breath_sessions` avoids importing `BreathSession` entity or `BreathSessionsModule`. Clean cross-module boundary.
- **SessionEvent enrichment** — new optional fields (`activityRefId?`, `activityRefType?`) are backward-compatible. All three emit sites in `ActivityEngine` (`endActivity`, `stopActivity`, `abandonActivity`) consistently include the new fields. Values from `saved.activityRefId` / `saved.activityRefType` are nullable on `LiveSession` — matches the optional typing.
- **EaseIn formula** — correctly implements the smoothing spec. Parameterized `$1` prevents SQL injection. Runs inside the existing pessimistic-write transaction. Gracefully skips when `activityRefType` is not `breath_session` or the breath session row is missing.
- **Upsert path** — the `orIgnore()` INSERT doesn't specify `maxCompletedComplexity`, which is correct: PostgreSQL uses the column default (`0`).
- **API response** — both `getStats()` branches return `maxCompletedComplexity`. Swagger `@ApiProperty` decorator is present with clear description.
- **Test verification** — `stats.worker.spec.ts` 2/2 PASS, `activity-engine.service.spec.ts` 12/12 PASS.
