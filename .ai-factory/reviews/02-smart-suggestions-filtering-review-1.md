# Review: Smart Suggestions Filtering — Round 1

## Scope
4 files changed: `stats.module.ts` (export), `breath-sessions.module.ts` (import), `breath-sessions.service.ts` (logic), plan file.

---

## Critical

### 1. All existing tests broken — constructor arity mismatch
`src/breath-sessions/breath-sessions.service.spec.ts`

The `BreathSessionsService` constructor changed from 2 params to 4 (`repository`, `settingsService`, `statsService`, `configService`). The constructor body calls `this.configService.get(...)` immediately.

All 4 `beforeEach` blocks instantiate the service with only 2 arguments:

```typescript
// Lines 41, 73, 108:
service = new BreathSessionsService(repository, {} as any);

// Line 143:
service = new BreathSessionsService(repository, settingsService as any);
```

`configService` is `undefined` → `this.configService.get(...)` throws `TypeError` at construction time. Every test in this file will crash.

**Fix:** Pass mock `statsService` and `configService` as the 3rd and 4th arguments in every `beforeEach`:

```typescript
const mockStatsService = {} as any;
const mockConfigService = { get: jest.fn().mockReturnValue(50) } as any;
service = new BreathSessionsService(
  repository,
  settingsService as any,
  mockStatsService,
  mockConfigService,
);
```

---

## Minor

### 2. `ConfigService.get<number>` returns string from env — potential string concatenation
`src/breath-sessions/breath-sessions.service.ts:31-33`

```typescript
this.suggestionsComplexityThreshold = this.configService.get<number>(
  'SUGGESTIONS_COMPLEXITY_THRESHOLD',
  50,
);
```

The `<number>` generic is compile-time only — if `SUGGESTIONS_COMPLEXITY_THRESHOLD` is set in `.env`, `ConfigService.get()` returns a **string** at runtime (e.g. `"50"`). This is harmless with the default `50` (number), but if the env var is ever set, the expression `stats.maxCompletedComplexity + this.suggestionsComplexityThreshold` becomes string concatenation (`"10.550"` instead of `60.5`), producing an inflated ceiling that effectively disables the filter.

**Fix:** Wrap in `Number()`:

```typescript
this.suggestionsComplexityThreshold = Number(
  this.configService.get('SUGGESTIONS_COMPLEXITY_THRESHOLD', 50),
);
```

This matches the safest pattern and prevents a silent bug when someone adds the env var later.

---

## Looks Good

- **Module wiring** — `StatsModule` exports `StatsService`, `BreathSessionsModule` imports `StatsModule`. No circular dependency (`StatsModule` → `AuthModule`, `BreathSessionsModule` → `AuthModule` + `StatsModule`). Clean.
- **Filter logic** — `maxCompletedComplexity > 0` check correctly skips filtering for new users with no stats. QueryBuilder uses parameterised `:maxComplexity` — no SQL injection risk.
- **getStats() call** — Single-row lookup on a unique-indexed `userId` column. Negligible overhead per suggestion request.
- **No migration needed** — Purely application-level logic change; no schema changes.
- **Import paths** — `src/stats/stats.service` and `src/stats/stats.module` follow the project's established `src/` prefix pattern.

---

## Verdict

1 critical issue (broken tests) and 1 minor issue (env var type coercion) must be fixed before commit.
