# Test plan — root excluded from stats + run history (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[07-exclude-root-from-stats]].

## Why this area (silent-failure filter)
A root abandoned on grace emits `SessionEvents.ABANDONED` exactly like a practice. If the stats guard is missing or wrong, the root silently inflates `totalSessions`, `totalDurationSeconds`, and streaks — wrong numbers, no error. The dangerous twin: over-guarding could also skip the **bio flush** that rides the same event, silently dropping buffered bio.

## Behavior under change — think hard before writing
The ABANDONED event fans out to multiple `@OnEvent` handlers (stats finalise, bio flush, instruction flush). The guard must suppress **only** the stats handler. Trace each handler and assert the others still fire for a root. If the spec routes the guard somewhere that also affects flush, record it under **Findings**.

## Red/Green contract
- **Target (RED until [[07-exclude-root-from-stats]]):** stats skip + listRuns exclusion.
- **Characterization (GREEN now, stay GREEN):** a non-root (`breath`/`meditation`) ABANDONED/COMPLETED/INTERRUPTED still finalises stats and still flushes bio. A RED here after the change = the guard caught the wrong type → Class B, escalate.

## Instantiation
`StatsWorker` with a mocked `StatsService` (spy `finalise`). For listRuns, `SessionsService` with a mocked `Repository`/QueryBuilder (assert the `activityType != root` where-clause is applied). For the flush-still-fires check, `BiometricStreamEngine` with a spy on `flush`.

## Test cases
### Stats
- should NOT call `statsService.finalise` for an ABANDONED root — target→07
- should call `finalise` for an ABANDONED breath/meditation — char
- should still apply the min-duration filter to non-root sessions — char
### Bio flush coexistence
- should still flush the bio buffer on a root ABANDONED (guard touches stats only) — target→07 (assert flush spy called for root)
### Run history
- should exclude `activityType='root'` rows from `listRuns` — target→07
- should still return breath/meditation rows with `endedAt` set — char

## Gotchas
- Stats and bio flush are separate `@OnEvent` subscribers — guarding one must not import/branch the other.
- `listRuns` already filters `endedAt IS NOT NULL`; an abandoned root has `endedAt`, so only the new type filter keeps it out.

## Findings
_(fill during test-writing; escalate to [[07-exclude-root-from-stats]] before implementing it)_
