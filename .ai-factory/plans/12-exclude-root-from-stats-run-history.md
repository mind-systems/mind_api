# Plan: Exclude root from stats + run history

## Context
A root session abandoned on disconnect grace emits `SessionEvents.ABANDONED`, which currently pollutes `user_stats` and surfaces in the run-history list. This milestone guards both paths so root (presence-only) sessions never count toward streak/duration and never appear in `listRuns`, while leaving the separate bio-flush handler intact.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Guard the stats and run-history paths

- [x] **Task 1: Early-return for root in `StatsService.finalise`**
  Files: `src/stats/stats.service.ts`
  At the very top of `finalise(event)` (before the duration computation at line 41, after the opening `logger.debug` at lines 37-39), add a single early-return:
  ```ts
  if (event.activityType === ActivityType.ROOT) return;
  ```
  `ActivityType` is already imported (line 7); `ROOT = 'root'` already exists on the enum (`src/realtime/enums/activity-type.enum.ts`). The guard MUST live in the service (not in `StatsWorker`) — it covers all three worker handlers (COMPLETED/ABANDONED/INTERRUPTED) in one place, and the committed test `stats.service.spec.ts:114` calls `svc.finalise(...)` directly and asserts `repo.manager.transaction` was NOT called, so a worker-level guard would leave that test RED. Place the return ABOVE the min-duration gate (lines 45-50) so the orthogonal min-duration behavior for non-root types is unchanged. Do NOT touch `src/realtime/services/biometric-stream-engine.service.ts` — its bio-flush `@OnEvent` handlers are separate and must still fire on root abandon.

- [x] **Task 2: Exclude root rows from `SessionsService.listRuns`**
  Files: `src/sessions/sessions.service.ts`
  In the `baseQuery` builder, insert an additional `.andWhere` after the `endedAt` filter (between current line 89 `.andWhere('ms.endedAt IS NOT NULL')` and line 90 `.orderBy('ms.startedAt', 'DESC')`):
  ```ts
  .andWhere('ms.activityType != :root', { root: ActivityType.ROOT })
  ```
  `ActivityType` is already imported in this file. This keeps breath and meditation rows while filtering out root sessions.
