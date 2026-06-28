# Test plan — root excluded from stats + run history (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[07-exclude-root-from-stats]].

## Test authoring constraints (the four lessons)
- **L1 — outcomes only:** assert the OUTCOME — `statsService.finalise` spy NOT called for a root event vs. called for a practice; the bio `flush` spy still called for a root. Do not assert the internal predicate expression the guard uses (e.g. `event.activityType === ActivityType.ROOT`) — spec 07 owns where/how the guard branches; assert only that finalise was/wasn't reached.
- **L2 — compile-now:** `ActivityType.ROOT` does not exist in the enum yet (spec 02 adds it). In `SessionEvent` fixtures set `activityType: 'root' as any` (cast the literal), mirroring `multi-session-lifecycle.spec.ts` (`activityType: 'root' as any`). `SessionEvent.endedAt`/`startedAt` are `Date` (`stats.service.ts:9-14`) — supply real Dates.
- **L3 — label by spec name:** mark target cases `RED until spec 07-exclude-root-from-stats`; never a phase number.
- **L4 — escalation valve:** the "practice still finalises / still flushes" cases are characterization invariants (true regardless of root work). A RED there after spec 07 = the guard caught the wrong type → genuine Class-B, escalate. The root-skip cases are target, expected RED now.

## Why this area (silent-failure filter)
A root abandoned on grace emits `SessionEvents.ABANDONED` exactly like a practice. If the stats guard is missing or wrong, the root silently inflates `totalSessions`, `totalDurationSeconds`, and streaks — wrong numbers, no error. The dangerous twin: over-guarding could also skip the **bio flush** that rides the same event, silently dropping buffered bio.

## Behavior under change — think hard before writing
The ABANDONED event fans out to multiple `@OnEvent` handlers (stats finalise, bio flush, instruction flush). The guard must suppress **only** the stats handler. Trace each handler and assert the others still fire for a root. If the spec routes the guard somewhere that also affects flush, record it under **Findings**.

## Red/Green contract
- **Target (RED until [[07-exclude-root-from-stats]]):** stats skip + listRuns exclusion.
- **Characterization (GREEN now, stay GREEN):** a non-root (`breath`/`meditation`) ABANDONED/COMPLETED/INTERRUPTED still finalises stats and still flushes bio. A RED here after the change = the guard caught the wrong type → Class B, escalate.

## Instantiation
`StatsWorker` with a mocked `StatsService` (spy `finalise`) — `new StatsWorker(statsService as any)` (single ctor arg, `stats.worker.ts:11`). The handler is `onSessionAbandoned(event: SessionEvent)` (`stats.worker.ts:32-49`); call it directly with a fixture event. For the flush-still-fires check, `BiometricStreamEngine.onSessionAbandoned({ sessionId })` (`biometric-stream-engine.service.ts:216-226`) with a spy on `flush`. For listRuns, `SessionsService` with mocked repos.

## Test cases
### Stats
- should NOT call `statsService.finalise` for an ABANDONED root — target→07
- should call `finalise` for an ABANDONED breath/meditation — char
- should still apply the min-duration filter to non-root sessions — char
### Bio flush coexistence
- should still flush the bio buffer on a root ABANDONED (guard touches stats only) — target→07 (assert flush spy called for root)
### Run history
- should exclude `activityType='root'` rows from `listRuns` — target→07 (assert the returned `items` contain no root row, NOT the query-builder where-clause text)
- should still return breath/meditation rows with `endedAt` set — char

## Exact pins (read from source)
- **Stats handlers are per-event, separate from bio:** `StatsWorker.onSessionCompleted/Abandoned/Interrupted` each call `statsService.finalise(event)` (`stats.worker.ts:13-68`). `BiometricStreamEngine.onSessionAbandoned` etc. flush via a `{ sessionId }` payload (`biometric-stream-engine.service.ts:204-250`). They subscribe to the same `SessionEvents.ABANDONED` independently — confirms the guard must touch only the StatsWorker path.
- **Stats event shape:** `SessionEvent { sessionId, userId, startedAt: Date, endedAt: Date, activityType }` (`stats.service.ts:9-14`). The root-skip guard branches on `event.activityType`.
- **Min-duration filter lives INSIDE finalise:** `stats.service.ts:41-49` (`durationSeconds < this.minSessionDurationS` → early return). The "still apply min-duration to non-root" char case must drive `StatsService.finalise` directly (not the worker spy) to observe the skip — assert the stats-row write does NOT happen for a sub-threshold practice.
- **listRuns current filter:** `sessions.service.ts:88-90` — `ms.userId = :userId` AND `ms.endedAt IS NOT NULL`, ordered by `startedAt DESC`. No `activityType` filter today; an abandoned root HAS `endedAt`, so spec 07 must add an `ms.activityType != :root` (or `!= 'root'`) `andWhere`. Assert the OUTCOME (root absent from `items`), not the SQL string.

## Gotchas
- Stats and bio flush are separate `@OnEvent` subscribers — guarding one must not import/branch the other.
- `listRuns` already filters `endedAt IS NOT NULL` (`sessions.service.ts:89`); an abandoned root has `endedAt`, so only the new type filter keeps it out.

## Findings
_(fill during test-writing; escalate to [[07-exclude-root-from-stats]] before implementing it)_
