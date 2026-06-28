# Exclude root sessions from stats and run history

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- The root session is presence, not a practice. It must never count toward streak / total duration, and must never appear in the run-history list. Without this guard, a root abandoned on disconnect grace would emit `SessionEvents.ABANDONED` and pollute `user_stats`.

## Details

### Current state (verified line numbers)
- `src/stats/stats.worker.ts` — three handlers, each calling `this.statsService.finalise(event)`: `onSessionCompleted` `@OnEvent(SessionEvents.COMPLETED)` (lines 13-30), `onSessionAbandoned` `@OnEvent(SessionEvents.ABANDONED)` (lines 32-49), `onSessionInterrupted` `@OnEvent(SessionEvents.INTERRUPTED)` (lines 51-68). Payload type `SessionEvent` (`stats.service.ts:9-16`) carries `activityType: ActivityType` (field at line 14) plus `sessionId`, `userId`, `startedAt`, `endedAt`, optional `activityRefId`.
- `src/stats/stats.service.ts` — `finalise(event)` (lines 36-120) updates `user_stats`. Only filter is min-duration (`durationSeconds < this.minSessionDurationS`, lines 45-50); no type exclusion.
- `src/sessions/sessions.service.ts` `listRuns` — `baseQuery` built at lines 78-90; `.where('ms.userId = :userId', …)` is line 88, `.andWhere('ms.endedAt IS NOT NULL')` is line 89, `.orderBy('ms.startedAt', 'DESC')` is line 90. A root (abandoned → has `endedAt`) would surface.

### Change
1. Guard placement: at the **top of `StatsService.finalise`** (`stats.service.ts:36-37`, before the duration computation at line 41) add an early return:
   ```ts
   if (event.activityType === ActivityType.ROOT) return;
   ```
   `ActivityType` is already imported at `stats.service.ts:7` (`../realtime/enums/activity-type.enum`). `ROOT` is added to that enum by [[02-root-activity-type]]. Guarding in the service covers all three worker handlers in one place; alternatively guard each `StatsWorker` handler — pick the service to avoid triplicating the check.
2. `listRuns` baseQuery: insert an additional `.andWhere` after the `endedAt` filter (between current lines 89 and 90, before `.orderBy`):
   ```ts
   .andWhere('ms.activityType != :root', { root: ActivityType.ROOT })
   ```
   `ActivityType` is already imported at `sessions.service.ts:20`.

### Guards / gotchas
- Do **not** skip the bio flush for root. The bio flush lives in `src/realtime/services/biometric-stream-engine.service.ts` as **separate** `@OnEvent` handlers keyed by `payload.sessionId`: `onSessionCompleted` `@OnEvent(SessionEvents.COMPLETED)` (lines 204-213), `onSessionAbandoned` `@OnEvent(SessionEvents.ABANDONED)` (lines 216-225), `onSessionInterrupted` `@OnEvent(SessionEvents.INTERRUPTED)` (lines 228-238), `onSessionRevoked` `@OnEvent(SessionEvents.REVOKED)` (line 240+). These must still run on root abandon so buffered bio is persisted. Guarding the *stats* path (`StatsService.finalise`) does not touch these handlers — leave `biometric-stream-engine.service.ts` untouched.
- The min-duration filter (`WS_MIN_SESSION_DURATION_S`, default 10 — `stats.service.ts:30-33`) is orthogonal and stays.

### Verify
- Connect + disconnect a stream with no activity → root abandoned → `user_stats` unchanged.
- `GET /users/me/stats` ignores root.
- Run-history list excludes root rows.

## Open Questions
- None.
