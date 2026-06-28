# Exclude root sessions from stats and run history

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- The root session is presence, not a practice. It must never count toward streak / total duration, and must never appear in the run-history list. Without this guard, a root abandoned on disconnect grace would emit `SessionEvents.ABANDONED` and pollute `user_stats`.

## Details

### Current state
- `src/stats/stats.worker.ts` — `@OnEvent` on `COMPLETED` / `ABANDONED` / `INTERRUPTED` each call `statsService.finalise(event)`. The event payload carries `activityType` (emitted by `ActivityEngine`).
- `src/stats/stats.service.ts` — `finalise` updates `user_stats` (min-duration filter applies but does not exclude by type).
- `src/sessions/sessions.service.ts` `listRuns` — returns all `module_sessions` with `endedAt IS NOT NULL`; a root (abandoned → has `endedAt`) would surface.

### Change
1. In `StatsWorker` (or at the top of `StatsService.finalise`): early-return when `event.activityType === ActivityType.ROOT`. Prefer the worker so the service stays single-responsibility.
2. `listRuns` baseQuery: add `.andWhere('ms.activityType != :root', { root: ActivityType.ROOT })`.

### Guards / gotchas
- Do **not** skip the bio flush for root: `BiometricStreamEngine.onSessionAbandoned` (keyed by sessionId) must still run on root abandon so buffered bio is persisted. Only the *stats* path is skipped. These are separate `@OnEvent` handlers — guarding stats does not touch bio flush.
- The min-duration filter (`WS_MIN_SESSION_DURATION_S`) is orthogonal and stays.

### Verify
- Connect + disconnect a stream with no activity → root abandoned → `user_stats` unchanged.
- `GET /users/me/stats` ignores root.
- Run-history list excludes root rows.

## Open Questions
- None.
