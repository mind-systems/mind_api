# Plan: Smart Suggestions Filtering

## Context
Filter the suggestions endpoint (`GET /breath_sessions/suggestions`) so it only returns sessions whose complexity is within the user's comfort zone: `complexity ≤ maxCompletedComplexity + threshold`. This prevents overwhelming users with sessions far above their demonstrated ability. Depends on the `maxCompletedComplexity` column added in milestone 01 (User Complexity Tracking).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Cross-module wiring

- [x] **Task 1: Export StatsService and wire it into BreathSessionsModule**
  Files: `src/stats/stats.module.ts`, `src/breath-sessions/breath-sessions.module.ts`, `src/breath-sessions/breath-sessions.service.ts`
  `StatsModule` currently exports nothing. Add `StatsService` to the `exports` array so other modules can consume it:
  ```typescript
  // src/stats/stats.module.ts
  @Module({
    imports: [TypeOrmModule.forFeature([UserStats]), AuthModule],
    providers: [StatsService, StatsWorker],
    controllers: [StatsController],
    exports: [StatsService],
  })
  ```
  Then import `StatsModule` in `BreathSessionsModule`:
  ```typescript
  // src/breath-sessions/breath-sessions.module.ts
  imports: [
    TypeOrmModule.forFeature([BreathSession, BreathSessionSettings]),
    AuthModule,
    StatsModule,
  ],
  ```
  Finally, inject `StatsService` into `BreathSessionsService` constructor alongside the existing dependencies. This follows the architecture pattern — modules communicate through exported providers, never through cross-module repository access.

### Phase 2: Filtering logic

- [x] **Task 2: Add complexity ceiling filter to findSuggestions** (depends on Task 1)
  Files: `src/breath-sessions/breath-sessions.service.ts`
  Add a private readonly constant for the threshold (e.g., `SUGGESTIONS_COMPLEXITY_THRESHOLD`). Read it from `ConfigService` with env var `SUGGESTIONS_COMPLEXITY_THRESHOLD` and a sensible default (e.g., `50`). `ConfigService` is already globally available — inject it in the constructor if not already present.

  Update `findSuggestions(userId, timeOfDay)` to:
  1. Call `this.statsService.getStats(userId)` to obtain `maxCompletedComplexity` (returns `0` for users with no stats row — the zero-default path already exists in `StatsService.getStats()`).
  2. If `maxCompletedComplexity` is `0` (new user, no completed live sessions yet), skip the complexity filter entirely — return results using the current query unchanged. This preserves backward-compatible behavior: users who have never completed a live session see all their sessions as suggestions, regardless of complexity.
  3. Otherwise, add `.andWhere('session.complexity <= :maxComplexity', { maxComplexity: maxCompletedComplexity + threshold })` to the existing `QueryBuilder` chain, before `.orderBy('RANDOM()')`.

  The method signature stays the same. No controller or DTO changes are needed — the filtering is purely server-side.
