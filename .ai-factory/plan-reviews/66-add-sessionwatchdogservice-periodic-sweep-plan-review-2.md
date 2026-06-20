# Plan Review (2): Add `SessionWatchdogService` periodic sweep

**Plan:** `.ai-factory/plans/66-add-sessionwatchdogservice-periodic-sweep.md`
**Files Reviewed:** 8 (plan + 7 codebase targets)
**Risk Level:** 🟢 Low

## Verification Summary

Every concrete claim in the plan was checked against the codebase and found accurate:

| Plan claim | Verified |
|---|---|
| `RealtimeConfig` uses string env-var names + `as const` | ✅ `realtime-config.ts:1-12` |
| `abandonStale` at `activity-engine.service.ts:196`, unconditional `delete(userId)` at line 226 | ✅ exact match |
| `!session` early return at 198-201; already-finalized branch at 208-211 | ✅ exact match (lines 199, 209) |
| `handleActivityStart` guards only on `getActiveSession` | ✅ `module-state.grpc.controller.ts:261` |
| `StreamEngine` ctor/bootstrap/shutdown pattern (`46-61`, `68-81`, field `37`, guard `76-81`) | ✅ exact match |
| `observability.service.ts:15` literal `@Interval(60_000)` fallback | ✅ exact match |
| `ScheduleModule.forRoot()` registered | ✅ `app.module.ts:37` |
| `ModuleSession` on `forFeature`, `ActivityEngine` already a provider | ✅ `realtime.module.ts:25-29, 41` |
| `SessionStatus.ACTIVE` / `DISCONNECTED` are the only non-final stuck statuses | ✅ enum; `RESUMED` is never persisted (`resumeActivity` sets `ACTIVE`) |
| `lastActivityAt` bumped only on persisting flush (`stream-engine.service.ts:164`) | ✅ matches note 52 staleness signal |

### Correctness highlight — Task 2 is genuinely necessary and correctly analyzed

The race described in Task 2 is real. Walked it through against the code:

1. Orphan `ACTIVE` row `S1` with no store entry.
2. `handleActivityStart` (`module-state.grpc.controller.ts:261`) guards only on the in-memory store, which is empty → creates `S2`, store now points at `S2`.
3. Watchdog reaps `S1` → `abandonStale(U, S1)` → unconditional `activitySessionStore.delete(U)` (line 226) evicts **`S2`**, silently killing the live session.

The proposed fix (guard the delete by `state?.sessionId === sessionId`) closes this in all three exit paths. The plan's reasoning that the grace-timer caller is unaffected is sound — there the stored `sessionId` always equals the reaped one. The plan's instruction to leave `abandonActivity` untouched is also correct: for `abandonActivity` to run, a store entry must exist for the user, and `handleActivityStart` cannot create `S2` while that entry persists (it returns `existing`), so its unconditional delete can only ever evict its own session. The asymmetry between the two methods is exactly why only `abandonStale` (which is driven by a DB-`userId` lookup, not a store entry) needs the guard.

### Architecture / lifecycle interactions checked

- **Double-fire with grace timer (DISCONNECTED rows):** benign. Whichever finalizes first sets `ABANDONED`; the other lands on the `finalStatuses` no-op branch. Idempotent.
- **Routing through `SessionEvents.ABANDONED`:** correct — this is what drives `StreamEngine`/`BiometricStreamEngine` `@OnEvent` handlers to flush + `buffers.delete`. A bare `repo.update` would leak buffers (per note 52 §"Why route through events").
- **No migration required:** no schema change. `status` and `userId` are already indexed (`module-session.entity.ts:12-13`).
- **No pause special-casing:** consistent with note 52 §"Pause is NOT a problem" and Phase 49.

## Context Gates

- **Architecture (`ARCHITECTURE.md` / module rules):** ✅ PASS. New service lives in `RealtimeModule`, injects only the module's own `ModuleSession` repo and the module-internal `ActivityEngine` — no cross-module entity injection. Not exported, matching the module's encapsulation rule.
- **Rules (`RULES.md`):** ✅ PASS. (1) No `!` non-null assertion — the plan's guard uses `state?.sessionId`, optional chaining, not force-unwrap. (2) No sensitive data logged — plan logs `sessionId`, `userId`, idle ms, counts only (UUIDs/outcomes). (3) Logs lean — warn-per-reap + one summary, no entry/exit spam. The gRPC `@Payload()` rule is not applicable (no controller changes).
- **Roadmap (`ROADMAP.md`):** ✅ PASS. Directly implements the open Phase 42 milestone "Add `SessionWatchdogService` periodic sweep" (`ROADMAP.md:241`). The dependency milestone `abandonStale` (`ROADMAP.md:239`) is already `[x]` and present in code. Config keys, query predicate, defaults (600_000 / 60_000), inject list, and read-only-on-`lastActivityAt` constraint all match the milestone text.

## Non-blocking Observations

1. **Optional `(status, last_activity_at)` index not mentioned (WARN, informational).** Note 52 §"Concurrency / correctness guards" explicitly says to *mention but not force* a composite index, deferring it as "likely unnecessary at current scale." The plan omits it entirely. This is acceptable — the sweep filters on the already-indexed `status` column and runs every 60s over a small table — but a one-line note acknowledging the deferred index would have fully tracked the spec. Not a defect.

2. **`ConfigService.get<number>(...)` returns a string when the env var is set (informational).** The `<number>` generic is a compile-time assertion only; no runtime coercion. So `maxIdleMs` may hold `"600000"`. This is harmless here — `Date.now() - this.maxIdleMs` and `setInterval(cb, this.sweepIntervalMs)` both coerce numerically — and it is identical to the existing `StreamEngine` constructor pattern the plan deliberately mirrors. Calling it out only so the implementer is not surprised; no change needed for consistency.

3. **`abandonStale` on a DB-only orphan briefly creates a stream buffer (informational).** `streamEngine.push` lazily creates a buffer for `S1` to write the ABANDONED marker, which the `ABANDONED` handler then flushes and deletes. Net effect: one tiny sample row, then cleanup — same behavior as every other finalization path. Expected, not a concern.

## Positive Notes

- The plan correctly elevates the `abandonStale` store-delete hardening (Task 2) to a **prerequisite** that must land with the watchdog, rather than treating it as optional — this is the single highest-value correctness item and it would not have been caught by following the roadmap milestone alone.
- Line-level precision throughout (every cited line number is exact), explicit "do X, not Y" guidance (`ReturnType<typeof setInterval>` not `NodeJS.Timeout`; guard `clearInterval`), and per-row `try/catch` isolation so one bad row never aborts the batch.
- Task dependencies (1,2 → 3 → 4) are correctly ordered and the failure-isolation + summary-logging design satisfies the "never silent" requirement from the spec.

PLAN_REVIEW_PASS
