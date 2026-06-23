# Code Review #2: (C2) `agg=lttb` mode (shape-preserving, non-lagging)

**Plan:** `.ai-factory/plans/78-c2-agg-lttb-mode-shape-preserving-non-lagging.md`
**Changes reviewed:** `git diff HEAD` —
`src/sessions/biometric-aggregation.util.ts`, `src/sessions/biometric-aggregation.util.spec.ts`,
`src/sessions/dto/time-range-query.dto.ts`, `src/sessions/sessions.service.ts`
(+ docs: `ROADMAP.md`, note `61`).
**Independent second pass.** Verified by re-reading each changed file in full, hand-tracing the
algorithm, and *running* the suite + a type-check (results below).

**Verdict:** 🟢 Correct, faithful to the plan, and now safe to merge for Commit 1. One substantive
follow-up remains (M1 below) but it is an explicitly-accepted, tracked performance ceiling
(Task 6 measurement), not a bug.

---

## Dynamic verification (this pass)

- **Unit suite passes:** `npx jest src/sessions/biometric-aggregation.util.spec.ts` →
  **20/20 green**, including all `lttb` tiling-byte-equality cases (single type, multi-type shared
  `bucketStart`, multi-window/multi-field), determinism, spike-vs-avg, and the four edge cases
  (single-point, two-point area-0 fallback, three-collinear fallback, empty window).
- **C2 code type-checks clean:** `tsc --noEmit` reports **no** errors in any C2-touched file. The
  errors it does report are all in `src/realtime/services/biometric-stream-engine.service.spec.ts`
  — **pre-existing** (last touched by commit `c6ad449`, not in this diff) and **excluded from the
  production build** (`tsconfig.build.json` excludes `**/*spec.ts`). Non-blocking, not introduced
  here. (See informational note I3.)

## Confirmed correct (independent trace)

- **Selection (`selectLttbPoint`)** matches the pinned rule. Endpoints A and C always yield area 0
  (verified algebraically), so the max-area pick is always interior or the mean-deviation fallback —
  which is exactly the documented endpoint-spike limitation. `Math.abs` preserves troughs as well as
  peaks. Fallback (`maxDev = -1`, reset `selected = first`) is deterministic and always assigns.
- **Numerical safety:** the area uses only *within-bucket* `ts` differences (`c.ts−a.ts`, `p.ts−a.ts`,
  each ≤ bucket width), so there is no large-magnitude cancellation despite absolute epoch-ms inputs;
  products stay far under 2^53. No overflow/precision concern for realistic bucket widths.
- **Bucket-local ⇒ tiling holds:** selection reads only points inside one absolute (epoch-anchored)
  bucket, so a bucket-aligned windowed request sees the identical point set as the full session →
  byte-equal. The `LIMIT cap+1` + post-query `> cap` throw means a truncated rowset never silently
  yields partial buckets (it 413s), so successful responses always tile. Order-independence holds even
  without SQL `ORDER BY` because `reshapeLttbRows` re-sorts each group and applies the final
  `(timestamp, sampleType)` total sort.
- **`collectRawPoints` faithfully mirrors the points SQL** (garbage bound, half-open window,
  object-`data` guard, numeric-leaf `typeof === 'number'`), making the spec a trustworthy reference.
- **Per-field independence:** a field present in only some samples of a bucket is selected over just
  its own points; output `data` carries one selected value per field, keys sorted. Correct.
- **SQL/security:** `${strategy.selectColumns}` and `LIMIT ${LTTB_POINTS_ROW_CAP+1}` interpolate only
  module constants; all request-derived values are parameterized (`$n`). `agg` is constrained by
  `@IsIn(['minmax','avg','lttb'])` under the global `ValidationPipe`
  (`whitelist + forbidNonWhitelisted`), so an unknown mode 400s before the `AGG_REGISTRY` lookup.
- **RULES:** no non-null assertions; optional/index access explicitly guarded; logging unchanged (lean).

## Review-1 follow-ups — resolved

- ✅ **413 message** no longer recommends `bucketSec` (which doesn't shrink the un-grouped points
  rowset); now reads "Result set too large; narrow the time window" (service line ~344).
- ✅ **Cap comment** is now honest — explicitly labels `3_000_000` a "conservative placeholder pending
  a real Task 6 measurement" and says to lower it to measured-max + headroom (service lines 26-32).

---

## Medium

### M1. The `'points'` path still reshapes up to ~3M rows synchronously; the cap is an unmeasured placeholder, and Task 6 is not yet done
`LTTB_POINTS_ROW_CAP = 3_000_000` is the *allowed* maximum, and `reshapeLttbRows` runs entirely
**synchronously** on the single Node thread (build a 1–3M-entry Map, sort every group, scan to
select). Critically, the **intended primary workload** — the 389k-motion reference session — is
itself ~1–2M points, so *every legitimate* `lttb` request on that session pulls ~1–2M rows over the
wire and blocks the event loop for the duration of the reshape (order of hundreds of ms), stalling all
other requests on the instance. This is the resource profile Phase 48 server-side aggregation exists to
avoid; the grouped path sidesteps it by reducing inside Postgres.

The plan accepted this consciously (note 58: don't pre-optimize, measure first), and the cap comment
now flags it as a placeholder. So this is **not a blocker for Commit 1** — but it is the one real open
item: Task 6's measurement against the 389k session has not been performed, so the cap is a guess and
the actual blocking cost is unquantified.

**Recommendation (Task 6, before C2 is considered "done"):** run `agg=lttb` against the 389k-motion
session; record the observed points-row count and the Node reshape wall-time; lower
`LTTB_POINTS_ROW_CAP` to measured-max + headroom; and confirm the synchronous stall is acceptable for
this authenticated, owner-scoped historical endpoint (if not, the documented lower-fidelity SQL-side
candidate reduction — a different algorithm requiring re-derived tests — is the fallback, per the plan).

---

## Low / Informational

### I2. Full-session-413 vs windowed-success is by design
A full-session `lttb` request exceeding the cap 413s while the same data fetched as bucket-aligned
windows (the web `makeWindowedVariant` consumer, Task 7a) succeeds. Expected behavior of the guard;
just ensure the web variant always tiles (it does, per plan). No action.

### I3. Pre-existing `tsc` errors in an unrelated spec
`tsc --noEmit` is currently red due to `biometric-stream-engine.service.spec.ts` (3 `TS2352` casts),
which predates this branch and is excluded from `tsconfig.build.json`. Not introduced by C2 and does
not affect the build; flagging only so it isn't mistaken for fallout from this change. Worth a separate
cleanup if CI ever type-checks specs.

### I4. `agg=lttb` without `bucketSec` silently ignores `agg`
As with `avg` in C1, aggregation only runs when `bucketSec` is provided; `agg=lttb` alone falls through
to the raw path. Consistent with existing behavior — noted for completeness, no change needed.

---

## Summary

| Sev | Finding |
|-----|---------|
| Medium | M1 — synchronous reshape of up to a *placeholder* 3M-row cap; Task 6 measurement not yet done, so the cap is unmeasured and the event-loop stall on the intended 389k workload is unquantified |
| Info | I2 — full-session-413 vs windowed-success (by design) |
| Info | I3 — pre-existing, build-excluded `tsc` errors in an unrelated spec |
| Info | I4 — `agg` without `bucketSec` is a no-op (consistent with C1) |

The change is **correct, tested, and mergeable for Commit 1**. The only substantive open item is
completing **Task 6** (measure the 389k session, then tighten `LTTB_POINTS_ROW_CAP` and confirm the
synchronous-reshape cost is acceptable). No correctness, security, or migration bugs found.
