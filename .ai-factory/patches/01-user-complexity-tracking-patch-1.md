# Patch: User Complexity Tracking — Review 1

## File: `src/stats/stats.service.spec.ts`

### Fix 1: `makeService()` missing `configService` argument (pre-existing)

`StatsService` constructor requires 2 arguments (`repo`, `configService`), but `makeService()` only passes `repo`. Every test crashes with `TypeError: Cannot read properties of undefined (reading 'get')` before any assertion runs.

**Line 79-87 — replace:**

```typescript
  function makeService(existingRow: Record<string, unknown> | null = null): {
    service: StatsService;
    repo: ReturnType<typeof makeRepo>;
  } {
    const repo = makeRepo(existingRow);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const svc = new StatsService(repo as any);
    return { service: svc, repo };
  }
```

**with:**

```typescript
  function makeService(existingRow: Record<string, unknown> | null = null): {
    service: StatsService;
    repo: ReturnType<typeof makeRepo>;
  } {
    const repo = makeRepo(existingRow);
    const configService = { get: jest.fn().mockReturnValue(10) };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const svc = new StatsService(repo as any, configService as any);
    return { service: svc, repo };
  }
```

**Why `10`:** The `configService.get('WS_MIN_SESSION_DURATION_S', 10)` call expects a number of seconds. Returning `10` matches the production default and keeps the existing test events (5s short, 20s/30s qualifying) working correctly.

---

### Fix 2: `getStats` test missing `maxCompletedComplexity` in expected object

`getStats()` now returns `maxCompletedComplexity: 0` in both branches, but the `toEqual()` assertion doesn't include it. `toEqual()` requires exact property match — extra properties cause failure.

**Line 254-260 — replace:**

```typescript
      expect(stats).toEqual({
        totalSessions: 0,
        totalDurationSeconds: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastSessionDate: null,
      });
```

**with:**

```typescript
      expect(stats).toEqual({
        totalSessions: 0,
        totalDurationSeconds: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastSessionDate: null,
        maxCompletedComplexity: 0,
      });
```

---

### Fix 3: `manager.query` mock missing — `finalise` tests will crash on complexity lookup

The `manager` mock inside `makeRepo()` does not define a `query` method. When `finalise()` is called with an event that has `activityRefType === 'breath_session'` and a truthy `activityRefId`, the code calls `manager.query(...)` which will be `undefined`.

Current tests don't pass `activityRefType`/`activityRefId` in events (so the `if` guard skips the query), but the mock should still have `query` defined to prevent future tests from silently crashing.

**Line 41-48 — replace:**

```typescript
  const manager = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    findOne: jest.fn().mockResolvedValue(existingRow),
    save: jest.fn().mockImplementation((_entity: unknown, row: unknown) => {
      saved.push(row as Record<string, unknown>);
      return Promise.resolve(row);
    }),
  };
```

**with:**

```typescript
  const manager = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    findOne: jest.fn().mockResolvedValue(existingRow),
    save: jest.fn().mockImplementation((_entity: unknown, row: unknown) => {
      saved.push(row as Record<string, unknown>);
      return Promise.resolve(row);
    }),
    query: jest.fn().mockResolvedValue([]),
  };
```

---

## Verification

After applying all three fixes, run:

```bash
npx jest src/stats/stats.service.spec.ts --no-coverage
```

Expected: 8/8 PASS.
