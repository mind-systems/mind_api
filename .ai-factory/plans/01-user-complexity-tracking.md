# Plan: User Complexity Tracking

## Context
Add a smoothed `maxCompletedComplexity` column to `user_stats` that tracks the user's peak breath session complexity over time. Updated on every qualifying session completion using an easeIn formula (`newMax = currentMax + (completed - currentMax) * factor`) to prevent sudden spikes from accidental hard sessions.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Schema

- [x] **Task 1: Add maxCompletedComplexity column to user_stats**
  Files: `src/migrations/<timestamp>-AddMaxCompletedComplexity.ts`, `src/stats/entities/user-stats.entity.ts`
  Generate a new migration via CLI (`npx typeorm migration:create src/migrations/AddMaxCompletedComplexity`). In the `up` method add column `"maxCompletedComplexity"` of type `double precision NOT NULL DEFAULT 0` to the `user_stats` table. In `down`, drop the column. Then add the corresponding field to the `UserStats` entity following the existing pattern:
  ```typescript
  @Column({ type: 'float', default: 0 })
  maxCompletedComplexity: number;
  ```
  Place it after `longestStreak` and before `lastSessionDate` for logical grouping.

### Phase 2: Event enrichment

- [x] **Task 2: Extend SessionEvent with activity reference fields** (depends on Task 1)
  Files: `src/stats/stats.service.ts`, `src/realtime/services/activity-engine.service.ts`
  Add `activityRefId?: string` and `activityRefType?: string` to the `SessionEvent` interface in `stats.service.ts`. Then update all three event emission sites in `ActivityEngine` (`endActivity`, `stopActivity`, `abandonActivity`) to include `activityRefId: saved.activityRefId` and `activityRefType: saved.activityRefType` in the emitted payload. These fields already exist on the `LiveSession` entity (`saved` object) — just spread them into the event.

### Phase 3: Business logic and API

- [x] **Task 3: Update StatsService.finalise() with easeIn complexity tracking** (depends on Task 2)
  Files: `src/stats/stats.service.ts`
  Inside `StatsService.finalise()`, after the existing streak/duration logic and within the same transaction:
  1. If `event.activityRefType === 'breath_session'` and `event.activityRefId` is present, resolve the completed session's complexity by running a raw query via the transaction manager: `SELECT complexity FROM breath_sessions WHERE id = $1`. This avoids importing `BreathSession` entity or `BreathSessionsModule` — respecting module boundaries.
  2. If complexity is found, apply the easeIn formula: `row.maxCompletedComplexity = row.maxCompletedComplexity + (complexity - row.maxCompletedComplexity) * EASE_IN_FACTOR`. Define `EASE_IN_FACTOR` as a private readonly constant at the top of the class (e.g., `0.3`). The formula naturally smooths both upward and downward movement.
  3. If the query returns no row (deleted session) or `activityRefType` is not `breath_session`, skip the complexity update silently.
  Note: the `row` is already locked with `pessimistic_write` — the new field is saved alongside existing stats in the same `manager.save()` call.

- [x] **Task 4: Expose maxCompletedComplexity in the stats response** (depends on Task 3)
  Files: `src/stats/dto/user-stats-response.dto.ts`, `src/stats/stats.service.ts`
  Add `maxCompletedComplexity: number` with `@ApiProperty({ description: 'Smoothed maximum complexity of completed breath sessions' })` to `UserStatsResponseDto`. Update both return paths in `StatsService.getStats()`: the zero-default branch should return `maxCompletedComplexity: 0`, and the row-mapping branch should return `maxCompletedComplexity: row.maxCompletedComplexity`.
