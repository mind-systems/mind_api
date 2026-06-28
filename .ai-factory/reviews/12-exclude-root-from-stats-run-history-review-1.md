# Code Review: Exclude root from stats + run history

**Branch:** `feature/root-session`
**Plan:** `.ai-factory/plans/12-exclude-root-from-stats-run-history.md`
**Scope reviewed:** `git diff HEAD` — two production files changed (`src/stats/stats.service.ts`, `src/sessions/sessions.service.ts`) plus plan/review artifacts.

## Summary

The implementation is minimal, correct, and matches the plan and spec (`.ai-factory/notes/07-exclude-root-from-stats.md`) exactly. Two one-line guards were added:

1. `src/stats/stats.service.ts:41` — `if (event.activityType === ActivityType.ROOT) return;` at the top of `finalise`, above the duration computation and min-duration gate.
2. `src/sessions/sessions.service.ts:90` — `.andWhere('ms.activityType != :root', { root: ActivityType.ROOT })` inserted into `baseQuery` between the `endedAt` filter and `orderBy`.

## Correctness verification

### Task 1 — stats guard
- The early-return sits **above** `repo.manager.transaction` (line 60), so root events never write `user_stats`. Confirmed.
- It sits **above** the min-duration gate (lines 47-52), so the orthogonal min-duration behavior for non-root types (`BREATH`/`MEDITATION`) is unchanged — the guard only fires on `ROOT`. Confirmed.
- Placement is in the **service**, not `StatsWorker`. Verified `stats.worker.ts` forwards every event type unconditionally across all three `@OnEvent` handlers (COMPLETED line 13, ABANDONED line 32, INTERRUPTED line 51), each delegating to `statsService.finalise(event)`. A single service guard therefore covers all three paths. Confirmed.
- `ActivityType` already imported (`stats.service.ts:7`); `ROOT = 'root'` exists on the enum (`activity-type.enum.ts:4`). No new import needed. Confirmed.

### Task 2 — listRuns exclusion
- The clause is added to `baseQuery`, from which **both** `getCount()` (line 93) and `getRawAndEntities()` (line 95) derive. This filters at the SQL level so pagination `total` stays consistent with the returned page — it correctly avoids the JS post-`.filter()` anti-pattern (which would inflate `total` and short-page). Confirmed.
- `ActivityType` already imported (`sessions.service.ts:20`). The `!=` operator excludes only `root`, preserving `breath` and `meditation` rows. Confirmed.

### Untouched paths (as required)
- `biometric-stream-engine.service.ts` was **not** modified. Its bio-flush `@OnEvent` handlers are keyed by `payload.sessionId` and are independent of the stats path, so buffered bio still flushes on root abandon. Correct scoping — no over-guarding.

## Tests

- `stats.service.spec.ts` "should NOT write user_stats for a root session" — **GREEN** (verified by running `-t "root"`).
- `sessions.service.spec.ts` "should add an activityType != root filter to the listRuns query" — **GREEN** (verified by running `-t "activityType != root filter"`). The literal SQL `'ms.activityType != :root'` satisfies the test's `/activityType/ && /!=/` matcher.

### Pre-existing failures (NOT caused by this change)
Running the two specs shows 3 failing tests, all under `SessionsService.deleteRun › orphan root cleanup`, explicitly labeled `[RED until spec 15-deleterun-orphan-root-cleanup]`. These are scaffolded RED tests for a **future** Phase 57 milestone (deleteRun orphan cleanup) that is not yet implemented. They are out of scope here.

Likewise, `npx tsc --noEmit` reports 3 errors, all in `biometric-stream-engine.service.spec.ts` (unrelated future test scaffolding). Verified these are **pre-existing**: stashing this change and re-running `tsc` still yields exactly 3 errors in the same file. This change introduces zero new type errors and touches neither file.

## Findings

None. The change is correct, minimal, well-scoped, and does not regress any existing behavior or test.

REVIEW_PASS
