# Code Review (pass 2): Client `client_timestamp_ms` → `startedAt`/`endedAt`

**Branch:** dev · **Scope:** full re-review of all working-tree changes, with downstream tracing.

## What changed since pass 1

- The three `prettier/prettier` errors flagged in review-1 (#1) are **fixed** — `module-state.grpc.controller.ts` end-dispatch and `handleActivityEnd` signature are now wrapped correctly.
- `src/main.ts`, `src/sessions/sessions.service.ts`, `src/sessions/sessions.service.spec.ts` now appear in the diff — these are **prettier-only reformatting** (line-wrapping of `numEnv(...)` calls, multi-line imports, multi-line object literals). No semantic change, and unrelated to this milestone (see finding #2).

## Re-verification (current tree)

- `npx jest activity-engine.service.spec.ts` → **22 passed** (client-ts start/end, fallback, zero/NaN, and the critical `lastActivityAt`-stays-server guard).
- `npx tsc --noEmit -p tsconfig.build.json` → **exit 0**.
- `npx eslint` on the three production files → **clean**; spec file → 0 errors, 3 pre-existing `no-unsafe-argument` warnings in test setup (not introduced here).
- Generated stub `longToNumber` confirmed present; `clientTimestampMs?: number` on both messages. No hand-edits.
- Watchdog invariant re-confirmed: `lastActivityAt = now` in both the DB row and the in-memory `ActivityState` mirror (`saved.lastActivityAt`). `coerceClientTs` handles Long/string/number and treats `0`/`NaN`/non-finite/`null`/`undefined` as absent.

The milestone logic is correct and faithfully implements the spec.

## Findings

### 1. [Medium — integrity] No start-side clamp + no max-duration cap in stats ⇒ unbounded `totalDurationSeconds` inflation (new vector)

This is the one substantive issue, traced end-to-end this pass:

- `coerceClientTs` rejects only absent/`0`/`NaN`/non-finite. A **finite but absurd** start value (e.g. `1`, or any far-past epoch) is accepted verbatim, so `startActivity` persists `startedAt = new Date(1)` (1970) with **no sanity rule** — by design, the spec's settled decision deliberately scopes the only clamp to the *end* side (`endedAt >= startedAt`).
- `endActivity`'s `clientEnd >= startedAt` guard then provides **no protection**: against a 1970 `startedAt`, essentially any client end passes, so `endedAt` is the client's (now-ish) value.
- This event flows to `StatsWorker.onSessionCompleted` → `StatsService.finalise` (`src/stats/stats.service.ts:41-50, 98`), which computes `durationSeconds = endedAt - startedAt`, applies a **minimum** filter (`WS_MIN_SESSION_DURATION_S`) but **no maximum**, then does `row.totalDurationSeconds += durationSeconds` inside the locked transaction.

**Net effect:** a client can fabricate an arbitrarily large session duration *instantly* (send `startedAt` = epoch, end normally) and permanently inflate its own lifetime `totalDurationSeconds`. The same path is reachable via `ABANDONED`/`INTERRUPTED` (those keep server `endedAt`, but `startedAt` is already client-sourced from start, so `serverNow − farPastStart` is still huge).

**Why this is new:** before this change, `startedAt`/`endedAt` were both server-stamped, so duration equalled real elapsed wall-time between the start and end commands — a client could only inflate by actually keeping a session open. After this change, duration is forgeable with no elapsed time.

**Blast radius is bounded** — a user can only corrupt **their own** per-user wellness stats (`totalDurationSeconds`); `currentStreak`/`lastSessionDate` key off server `todayUtc()` and are **not** forgeable via these fields. So this is vanity self-inflation, not cross-user or auth impact — hence Medium, not High.

**Recommendation (one of):**
- Preferred, and consistent with the spec's "settled" no-clamp-in-engine decision: add a **maximum plausible duration** guard in `StatsService.finalise` (symmetric with the existing min filter) — clamp or skip when `durationSeconds` exceeds a sane ceiling. This lives downstream and does not re-open the engine timestamp policy.
- Or consciously accept and document the inflatable `totalDurationSeconds` as a known property of the client-trust model.

This does **not** block the milestone (it implements the spec correctly), but the consequence was not traced in the spec note and should be a conscious decision by the owner.

### 2. [Low — hygiene] Unrelated reformatting bundled in the working tree

`src/main.ts`, `src/sessions/sessions.service.ts`, and `src/sessions/sessions.service.spec.ts` carry prettier-only changes with no connection to `client_timestamp_ms`. They look like incidental `--fix` output from a lint run over pre-existing edits. Confirm they belong in this PR/commit, or split them out so the milestone commit stays scoped (the plan's commit 2/3 do not mention them).

## Notes (verified non-issues)

- Backward compatibility intact: proto3 `optional` (synthetic-oneof presence) → old clients yield `undefined`, not `0` → server `now()` fallback. Matches the existing `optional ref_id` precedent.
- `endActivity` correctly leaves `lastActivityAt` untouched (session → `COMPLETED`, ignored by the watchdog).
- `SESSION_EVENT` markers and the `durationMs` log stay on server `Date.now()`.
- `new Date(ms)` uses epoch-millis (UTC) — correct. No timezone hazard.
- No migration required — `startedAt`/`endedAt` columns are unchanged; only the value source moves.

---

One Medium integrity finding (#1) worth an explicit accept-or-mitigate decision before merge, plus a hygiene note (#2). The milestone code itself is correct against the spec, compiles, lints clean, and passes its tests.
