# Code Review: Janitor for childless root sessions — review 1

**Plan:** `.ai-factory/plans/13-janitor-for-childless-root-sessions.md`
**Changed code:** `src/realtime/services/session-watchdog.service.ts` (the only source file touched)
**Verdict:** Correct, production-safe, and faithful to the plan + the committed test contract. One non-blocking informational note below; no required changes.

## What was verified

- `git status` / `git diff HEAD` — the only non-doc change is `session-watchdog.service.ts`. No migration, entity, enum, config-constant, or module-wiring change was needed (all prerequisites already landed: `ActivityType.ROOT`, the `rootSessionId` self-FK with `ON DELETE CASCADE`, and `RealtimeConfig.EMPTY_ROOT_TTL_MS`).
- Read the changed file in full and the committed spec `session-watchdog.service.spec.ts` in full.
- `npx jest src/realtime/services/session-watchdog.service.spec.ts` → **21/21 pass** (the four `[RED until spec 08…]` cases at 329/353/375/406 now green; characterization `:436` and lifecycle `:457-509` unperturbed).
- `npm run build` (nest build) → **clean**. The `tsc --noEmit` errors observed are confined to `biometric-stream-engine.service.spec.ts` (a pre-existing test-file type issue in a file this change does not touch) — unrelated to this work.

## Correctness confirmation

- **Query scope is correct.** `sweepEmptyRoots()` filters `activityType: ActivityType.ROOT` + `status In([ACTIVE, DISCONNECTED])` + `lastActivityAt LessThan(threshold)`, mirroring `sweep()` with the mandatory root scope. Without the root scope a disconnected practice *child* (whose `count({ rootSessionId: child.id })` is 0) would be misread as childless and cascade-deleted; the scope prevents that (spec P6).
- **Childless gate is correct.** `repo.count({ where: { rootSessionId: row.id } })` then `if (childCount !== 0) continue;`. A root with any child — including a *completed* child — is retained, which is the intended "bio alone never protects a root" rule. Reap fires only at `childCount === 0`.
- **Reap semantics correct.** Per-row `repo.delete({ id: row.id })` (mock-visible, not bulk QB). Because the gate guarantees zero children, the `ON DELETE CASCADE` only sweeps the root's own `bio_session_samples` / `session_stream_samples` — no child sessions are collaterally deleted. `abandonStale` is correctly NOT used for roots (it would orphan the bio).
- **Live-subscriber skip reused.** `hasLiveSubscriber(row.userId)` short-circuits before the count/delete, matching `sweep()`.
- **Scheduling correct.** Both sweeps run inside the single existing `setInterval(…, sweepIntervalMs)` with independent `.catch` handlers, so a failure in one cannot suppress the other and a second timer is not created — the lifecycle assertions (`toHaveBeenCalledTimes(1)`, interval `60_000`, `sweep` spy fired once) all hold.
- **Config read correct.** `emptyRootTtlMs` reads `WS_EMPTY_ROOT_TTL_MS` (default `600_000`); the spec injects `300_000` and the threshold assertion at `spec.ts:418` passes against the injected value.
- **No store-eviction added** — consistent with the plan's design note. Confirmed independently: grace period is 30s (`DEFAULT_GRACE_MS`) « the 10-min TTL, so a cleanly-disconnected childless root is `ABANDONED` (and store-evicted) long before it could be a candidate; restart-orphaned candidates face an empty in-memory store. No FK-dangling path exists.
- **No security surface.** Internal background janitor, no external input, parameterized TypeORM queries.

## Informational note (non-blocking, no change required)

The empty-result guard `if (staleRoots.length === 0) return;` does **not** actually protect against an `undefined` result — `staleRoots.length` itself throws `TypeError` when `staleRoots` is `undefined`. This is observable in the lifecycle test where `repo.find` resolves to `undefined`: the thrown `TypeError: Cannot read properties of undefined (reading 'length') at sweepEmptyRoots:112` is swallowed by the interval callback's `.catch`, so the test still passes. The plan's rationale ("the guard avoids relying on that `.catch`") is therefore slightly inaccurate — in this path it *does* still rely on the `.catch`.

This is **not a runtime bug**: TypeORM's `repository.find()` always resolves to an array (never `undefined`) in production, so the guard behaves exactly as intended against real data and the `length === 0` early-return is correct. Mirroring `sweep()`'s identical pattern is also the right consistency choice. No action needed; noted only so the rationale text isn't mistaken for a hardening guarantee it doesn't provide. If defensiveness against a non-array were ever desired, `if (!staleRoots?.length) return;` would close it.

REVIEW_PASS
