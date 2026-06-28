# Test plan — root excluded from stats + run history (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[07-exclude-root-from-stats]].

## Test authoring constraints (the four lessons)
- **L1 — observe the right outcome at the guard's own layer.** Spec 07 places **both** guards inside code a forwarding spy / mocked QB cannot see through:
  - **Stats exclusion:** the guard is an early return at the **top of `StatsService.finalise`** (`07-exclude-root-from-stats.md:18-22`), *not* in `StatsWorker`. The worker calls `finalise` unconditionally for every event type (`stats.worker.ts:32-49`), so a worker-level `statsService.finalise` spy can never observe spec 07's guard — a "finalise NOT called for root" assertion is permanently RED. **Drive the real `StatsService.finalise`** and assert the **`user_stats` write is skipped** (`repo.manager.transaction` not called), the same skip-observable as the existing min-duration case at `stats.service.spec.ts:98-106`.
  - **listRuns exclusion:** spec 07 implements it as a SQL `andWhere` (`07-exclude-root-from-stats.md:23-26`), which a mocked QueryBuilder cannot reflect in its output (the stub ignores the clause and `listRuns` maps every returned row), and `ROADMAP_TESTS.md` forbids a real-DB test. Assert the **builder contract** (an `andWhere` carrying an `activityType` filter) — the only way a mocked-QB unit test can characterize a SQL-level filter. An outcome-only assertion there would be permanently RED even after 07 and would steer the implementer toward a JS `.filter()` that breaks pagination (`total`/`take` computed before the filter).
  - In all cases do not assert the internal predicate expression (e.g. `event.activityType === ActivityType.ROOT`) — assert the downstream effect (no transaction / `andWhere` present).
- **L2 — compile-now:** `ActivityType.ROOT` does not exist in the enum yet (spec 02 adds it). In `SessionEvent` fixtures set `activityType: 'root' as any` (cast the literal), mirroring `multi-session-lifecycle.spec.ts` (`activityType: 'root' as any`). `SessionEvent.endedAt`/`startedAt` are `Date` (`stats.service.ts:9-14`) — supply real Dates.
- **L3 — label by spec name (targets only):** mark the two genuine target cases (stats-skip in the service spec, listRuns builder-contract) `RED until spec 07-exclude-root-from-stats`; never a phase number. The invariants (bio-flush, non-root still writes, min-duration) are **not** targets — do not stamp "RED until" on them.
- **L4 — escalation valve:** the "non-root practice still writes stats / still flushes / still min-duration-filters" cases are characterization invariants (true regardless of root work). A RED there after spec 07 = the guard caught the wrong type → genuine Class-B, escalate. The root-skip + listRuns cases are target, expected RED now.

## Why this area (silent-failure filter)
A root abandoned on grace emits `SessionEvents.ABANDONED` exactly like a practice. If the stats guard is missing or wrong, the root silently inflates `totalSessions`, `totalDurationSeconds`, and streaks — wrong numbers, no error. The dangerous twin: over-guarding could also skip the **bio flush** that rides the same event, silently dropping buffered bio.

## Behavior under change — think hard before writing
The ABANDONED event fans out to multiple `@OnEvent` handlers (stats finalise, bio flush, instruction flush). The guard must suppress **only** the stats handler. Trace each handler and assert the others still fire for a root. If the spec routes the guard somewhere that also affects flush, record it under **Findings**.

## Red/Green contract
- **Target (RED until [[07-exclude-root-from-stats]]):** stats skip (real `finalise` does **not** write `user_stats` for a root) + listRuns builder-contract (`andWhere` excludes root).
- **Characterization (GREEN now, stay GREEN):** a non-root (`breath`/`meditation`) session still writes `user_stats` and still flushes bio. A RED here after the change = the guard caught the wrong type → Class B, escalate.

## Instantiation
For the stats target, drive the **real `StatsService.finalise`** via the existing `makeService()` / `makeEvent(start, end, overrides)` helpers (`stats.service.spec.ts:9-22, 82-96`) — `new StatsService(repo, configService)`; assert `repo.manager.transaction` not called. **Do not** use a `StatsWorker` spy (the guard is in the service, not the worker; leave `stats.worker.spec.ts` untouched). For the flush-still-fires check, `BiometricStreamEngine.onSessionAbandoned({ sessionId })` (`biometric-stream-engine.service.ts:216-226`) with a spy on `flush`. For listRuns, `SessionsService` with mocked repos + a chainable QB whose builder methods return the same QB so `andWhere.mock.calls` can be inspected.

## Test cases
### Stats (in `stats.service.spec.ts`, real `finalise`)
- should NOT write `user_stats` for a root (duration ABOVE min, so min-duration doesn't pre-empt) — assert `repo.manager.transaction` not called — target→07
- non-root still writes `user_stats` — char — already covered by `stats.service.spec.ts:108-257` (tag, don't duplicate)
- should still apply the min-duration filter to non-root sessions — char — already covered by `stats.service.spec.ts:98-106` (tag, don't duplicate)
### Bio flush coexistence
- should still flush the bio buffer on a root ABANDONED (guard touches stats only) — **char/invariant** (GREEN now, must stay GREEN through 07; the flush path is independent of the stats guard, so there is nothing for 07 to flip GREEN — a RED here after 07 = guard reached into the bio path → Class-B, escalate). Assert flush spy called with the root `sessionId`.
### Run history
- should add an `activityType != root` filter to the `listRuns` query — target→07. **L1 carve-out (see below):** a mocked QueryBuilder cannot observe a SQL `andWhere` through its output, so assert the **builder contract** — that some `andWhere` call carries an `activityType` inequality (e.g. `qb.andWhere.mock.calls.some(([sql]) => /activityType/.test(sql) && /!=/.test(sql))`), keeping the matcher loose on the bound value (do not name `ActivityType.ROOT`, it does not exist yet). RED now (only `userId` + `endedAt IS NOT NULL` clauses exist), GREEN after 07 adds the clause.
- should still return breath/meditation rows mapped from the query result — char (locks the row-mapping shape; cannot itself verify the root is filtered, since the mock ignores the clause).

## Exact pins (read from source)
- **Stats handlers are per-event, separate from bio:** `StatsWorker.onSessionCompleted/Abandoned/Interrupted` each call `statsService.finalise(event)` (`stats.worker.ts:13-68`). `BiometricStreamEngine.onSessionAbandoned` etc. flush via a `{ sessionId }` payload (`biometric-stream-engine.service.ts:204-250`). They subscribe to the same `SessionEvents.ABANDONED` independently — confirms the guard must touch only the stats path (spec 07 places it inside `StatsService.finalise`), leaving the bio-flush handlers untouched.
- **Stats event shape:** `SessionEvent { sessionId, userId, startedAt: Date, endedAt: Date, activityType }` (`stats.service.ts:9-14`). The root-skip guard branches on `event.activityType`.
- **Min-duration filter lives INSIDE finalise:** `stats.service.ts:41-49` (`durationSeconds < this.minSessionDurationS` → early return). The "still apply min-duration to non-root" char case must drive `StatsService.finalise` directly (not the worker spy) to observe the skip — assert the stats-row write does NOT happen for a sub-threshold practice.
- **listRuns current filter:** `sessions.service.ts:88-90` — `ms.userId = :userId` AND `ms.endedAt IS NOT NULL`, ordered by `startedAt DESC`. No `activityType` filter today; an abandoned root HAS `endedAt`, so spec 07 must add an `ms.activityType != :root` (or `!= 'root'`) `andWhere`. **Assert the builder contract** (some `andWhere` call carries an `activityType` inequality), per the L1 carve-out — an outcome assertion (root absent from `items`) cannot work because the mocked QB ignores the clause and `listRuns` maps every returned row (`sessions.service.ts:99-113`, no JS-side filter).

## Gotchas
- Stats and bio flush are separate `@OnEvent` subscribers — guarding one must not import/branch the other.
- `listRuns` already filters `endedAt IS NOT NULL` (`sessions.service.ts:89`); an abandoned root has `endedAt`, so only the new type filter keeps it out.

## Findings
_(fill during test-writing; escalate to [[07-exclude-root-from-stats]] before implementing it)_
