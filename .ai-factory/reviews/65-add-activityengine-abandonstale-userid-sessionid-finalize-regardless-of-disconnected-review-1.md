# Code Review: `ActivityEngine.abandonStale(userId, sessionId)`

**Scope reviewed:** `git diff HEAD` — `src/realtime/services/activity-engine.service.ts` (new `abandonStale` method) and `src/realtime/services/activity-engine.service.spec.ts` (three new tests). Plan/JSON/plan-review docs are non-code and not reviewed for correctness.

**Verification run:**
- `npx jest src/realtime/services/activity-engine.service.spec.ts` → 15/15 pass (the 3 new `abandonStale` tests green).
- `npx tsc --noEmit` → no errors in the changed files (pre-existing TS errors exist only in `biometric-stream-engine.service.spec.ts`, untouched by this change).
- `npx eslint` on the two changed files → one error (`ActivityType` unused, see F6 — pre-existing) + 3 pre-existing `any`-cast warnings in the spec.

The implementation faithfully follows the plan: re-fetch by `sessionId`, already-finalized guard, set `ABANDONED`+`endedAt`, push the `SESSION_EVENT/ABANDONED` marker keyed by `sessionId`, delete the store entry, emit `SessionEvents.ABANDONED`. No migration is involved (only `status`/`endedAt` mutate on existing rows). The method is not yet wired to any production caller (only the tests call it) — it is the building block for the watchdog milestone.

Findings below are advisory; none block the milestone as a standalone building block, but F1 corrects an inaccurate claim in the plan-review and should inform the next (watchdog) milestone.

---

## F1 — [Medium] Concurrent double-fire would **double-count stats** (the plan-review's "harmless" claim is incomplete)

The plan-review (observation #2) concludes a concurrent double-emit of `ABANDONED` is "harmless: the handlers are idempotent." That is true only for the **stream-engine buffer handlers** (a second `flush` on an emptied buffer + a no-op `buffers.delete`). It overlooks the third consumer: `StatsWorker.onSessionAbandoned` (`src/stats/stats.worker.ts:32`) → `StatsService.finalise` (`src/stats/stats.service.ts:36`).

`finalise` is **additive and has no per-session dedup**:
```
row.totalSessions += 1;
row.totalDurationSeconds += durationSeconds;
row.currentStreak += 1 / longestStreak = max(...);   // streak also bumped
```
A second `ABANDONED` emit for the same `sessionId` therefore inflates `totalSessions`, `totalDurationSeconds`, and potentially the streak — user-visible stats corruption, not a no-op.

**Is this reachable here?** The already-finalized guard makes the **sequential** double-fire safe (the realistic case: grace timer fires, then the 60s watchdog runs minutes later — the second call re-fetches, sees `ABANDONED`/terminal status, returns without emitting). What it does **not** prevent is a genuinely concurrent interleave where two callers both read `DISCONNECTED`/`ACTIVE` before either `save`s:
1. `abandonStale` `findOne` → `DISCONNECTED` (awaits)
2. `abandonActivity` `findOne` → `DISCONNECTED` (awaits) — its guard `status !== DISCONNECTED` passes on the stale read
3. both `save` `ABANDONED`, both `emit` → `finalise` runs twice.

This is a read-then-write (check-then-act) race; the in-memory guard is not atomic with the DB write.

**Why it matters now / mitigation:** `abandonStale` has no production caller yet, so it is not live in this milestone — but the next milestone wires a periodic sweep that runs alongside the grace timer, which is exactly when this can fire. The robust fix belongs there: make the terminal transition atomic, e.g. a conditional update
`UPDATE module_sessions SET status='abandoned', endedAt=now WHERE id=$1 AND status IN ('active','disconnected')`
and emit **only** when the affected-row count is 1. That collapses the race for both `abandonStale` and `abandonActivity`. Recommend tracking this on the watchdog milestone rather than expanding this building-block PR.

## F2 — [Low] Emit/store-delete trust the `userId` argument instead of the fetched row's owner

The method already loads the row (`session.userId` is available) but emits and deletes the store keyed by the **passed** `userId`:
```
this.activitySessionStore.delete(userId);
this.eventEmitter.emit(SessionEvents.ABANDONED, { sessionId: saved.id, userId, ... });
```
Both the store key and `StatsService.finalise` (writes `user_stats` for `event.userId`) depend on `userId` being the row's true owner. If a future caller (the watchdog) ever passes a `sessionId`/`userId` that don't correspond, stats are finalized for the wrong user and the real owner's in-memory entry is never cleared. Since the row is already fetched, using `saved.userId` for the emit and the store delete would eliminate this mismatch class entirely and make the `userId` parameter redundant/defensive. Low severity (the contract assumes a matching pair), but it is a cheap robustness win and worth doing when the watchdog is added.

## F3 — [Low] A pending reconnect grace timer is not cancelled

For a `DISCONNECTED` row, `handleTransportDisconnect` may have armed a grace timer in `ActivitySessionStore.timers`. `abandonStale` calls `activitySessionStore.delete(userId)` (which only clears `activityMap`, not `timers`) but never `cancelGraceTimer(userId)`. The leftover timer still fires later and calls `abandonActivity`, which bails immediately on `if (!state) return` because the store entry is gone — so this is **benign** today and is in fact what makes the sequential double-fire safe. Flagging only so it is understood that sequential safety relies on that `!state` guard; consider a `cancelGraceTimer(userId)` for cleanliness when wiring the watchdog.

## F4 — [Nit] The `!session` (row-not-found) branch is untested

`abandonStale` has four branches; the tests cover three (the plan only required three). The early return when `repo.findOne` resolves `null` (lines 199–202: clears the store entry, no emit) has no test. Cheap to add: `repo.findOne.mockResolvedValue(null)` → assert `repo.save`/`emitter.emit` not called and the store entry cleared.

## F5 — [Nit] `streamEngine.push` assertion is vacuous

Tests (a) and (c) assert `expect.objectContaining({})` for the pushed payload, which matches any object. Consider asserting the marker shape (`data.event === StreamSessionEvent.ABANDONED`, `dataType === SESSION_EVENT`) so the test actually pins the `ABANDONED` stream event rather than just "push was called with this sessionId."

## F6 — [Pre-existing, not introduced here] Unused `ActivityType` import trips ESLint

`activity-engine.service.ts:10` imports `ActivityType`, which is unused, producing an ESLint **error** (`@typescript-eslint/no-unused-vars`). Confirmed pre-existing on `HEAD` (`git show HEAD:...` shows the same unused import) — this diff neither introduced nor touched it, and it is not auto-fixable by `npm run lint`'s `--fix`. Out of scope for this change, but since the file was modified here it is a convenient moment to drop the import and keep `npm run lint` green.

---

## Summary

The change is correct and complete for a standalone building block: behavior matches the plan, tests pass, types are clean for the touched files, and there is no schema/migration impact. The most important takeaway is **F1** — the idempotency assumption that justified the design is only valid for sequential calls; the stats path is additive, so the next milestone's atomic-transition design must close the concurrent-fire window to avoid stats corruption. F2–F6 are low-severity robustness/test/cleanup items.
