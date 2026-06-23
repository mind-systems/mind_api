# Code Review: (C2) `agg=lttb` mode (shape-preserving, non-lagging)

**Plan:** `.ai-factory/plans/78-c2-agg-lttb-mode-shape-preserving-non-lagging.md`
**Changes reviewed:** `git diff HEAD` —
`src/sessions/biometric-aggregation.util.ts`, `src/sessions/biometric-aggregation.util.spec.ts`,
`src/sessions/dto/time-range-query.dto.ts`, `src/sessions/sessions.service.ts`
(+ docs: `ROADMAP.md`, note `61`).

**Verdict:** 🟢 Implementation is correct and faithful to the plan. The bucket-local LTTB selection,
deterministic packing, registry generalization, and SQL dispatch all match the pinned design. The
byte-equal tiling gate holds by construction (selection is strictly bucket-local). Findings below are
quality/robustness issues, not correctness bugs.

---

## Verified correct

- **Selection rule** (`selectLttbPoint`) matches the pinned spec exactly: 1-point shortcut, triangle
  area without `/2`, max-area pick with first-in-sort-order tie-break, and the area-0 fallback to max
  `|value − mean|`. Hand-traced the three committed edge-case tests (2-point, 3-collinear, interior
  spike) — all produce the asserted values.
- **Area formula is numerically safe:** both terms use *within-bucket* `ts` differences
  (`c.ts − a.ts`, `p.ts − a.ts`, each ≤ `bucketMs`), so there is no large-magnitude
  catastrophic cancellation despite absolute epoch-ms timestamps. Good.
- **`Math.abs` on the area** means downward spikes (troughs) are preserved too, not only peaks.
- **Determinism / tiling:** per-group `(ts, value)` sort + per-bucket-local selection + final
  `(timestamp, sampleType)` total sort exactly mirror `reshapeAvgRows`. Because selection reads only
  points inside one absolute bucket, a bucket-aligned windowed request sees the identical point set as
  the full session → byte-equal. The committed tiling tests cover the single-type, multi-type-shared-
  bucketStart, and multi-window-multi-field cases.
- **`collectRawPoints`** mirrors the points SQL filters (garbage bound, half-open window, numeric-leaf
  `typeof === 'number'`, object `data` guard) the same way `aggregateRawSamples` mirrors the grouped
  SQL — the right test-only reference.
- **SQL assembly** (service lines 310–347): `${strategy.selectColumns}` is preserved in the shared
  header; the `'points'` branch correctly omits `GROUP BY`/`ORDER BY` and the grouped branch is
  byte-unchanged. `LTTB_POINTS_ROW_CAP` / `selectColumns` are constants — no injection surface; `agg`
  is validated by `@IsIn(['minmax','avg','lttb'])` under the global `ValidationPipe`
  (`whitelist + forbidNonWhitelisted`, main.ts:133), so an unknown `agg` 400s before reaching the
  `AGG_REGISTRY` lookup.
- **413 guard is correct:** `LIMIT cap+1` + post-query `rows.length > cap` throw means the path never
  silently truncates a bucket — it fails loudly, preserving the tiling contract for successful
  responses.
- **RULES compliance:** no non-null assertions; optional/index access is explicitly guarded
  (`first === undefined`, `last === undefined`) under `strictNullChecks`. Logging unchanged (lean).

---

## Medium

### M1. The 413 message recommends `bucketSec`, which does not reduce the points rowset
`sessions.service.ts:344-346`:
```ts
throw new PayloadTooLargeException(
  'Result set too large; use a narrower window or larger bucketSec',
);
```
On the `'points'` path the query has **no `GROUP BY`** — it returns one row per
`(sample element, numeric field)` regardless of `bucketSec` (the `floor(.../bucketMs)` is just a
projected column). So increasing `bucketSec` changes *bucketing* but leaves the returned row count —
and therefore the cap trigger — **unchanged**. Only narrowing the time window reduces rows. The advice
actively misdirects the caller. Drop the `bucketSec` clause (suggest "narrow the time window"), or, if
you want a real lever, document that only `from`/`to` shrink the `lttb` rowset.

### M2. Up to ~3M rows are pulled into Node and reshaped synchronously — event-loop / memory risk
`LTTB_POINTS_ROW_CAP = 3_000_000` (service line 32) is the *allowed maximum*, and `reshapeLttbRows`
processes the whole rowset **synchronously** (build a Map of `{ts,value}` objects, sort every group,
scan for selection). At the cap that is several million short-lived JS objects plus N array sorts on
the single Node thread — hundreds of ms to seconds of event-loop stall plus significant GC pressure,
blocking *all* other requests on this instance for the duration. This is the exact resource profile the
Phase 48 server-side aggregation was built to avoid; the grouped path sidesteps it by reducing inside
Postgres.

This is inherent to the chosen "pull points, select in Node" approach (the plan accepted it, note 58 —
don't pre-optimize), so it is not a correctness defect. But 3M is a very high ceiling for a synchronous
path. Recommend: (a) confirm the cap was set from the **actual** Task 6 measurement of the 389k-motion
session rather than a round guess (the comment at lines 28-31 asserts it was "derived by measuring …
adding ~50% headroom" — verify that measurement was really run and record the observed row count / wall
time), and (b) consider setting the cap closer to the measured maximum + headroom so a pathological
request can't queue ~3M-row reshapes.

---

## Low / Nits

### L1. Cap provenance comment may overstate certainty
`sessions.service.ts:28-31` states the 3M value "was derived by measuring the 389k-motion session row
count and adding ~50% headroom." If Task 6's measurement was not actually executed against that
session, this comment is misleading to future maintainers. Either back it with the recorded numbers
(row count + timing, ideally in the plan/note) or soften it to "conservative placeholder pending
measurement."

### L2. `processAvg` test helper carries contradictory thinking-out-loud comments
`biometric-aggregation.util.spec.ts:46-58` — the helper works (it rebuilds avg rows from
`collectRawPoints` because `aggregateRawSamples` returns min/max, not avg), but the comment block
narrates several abandoned approaches ("Actually, we need the real avg path. Let's use …"). Test-only,
no behavioral impact; trim to a single sentence describing what it does.

### L3. Informational — full-session 413 vs windowed success is expected, not a bug
A full-session `lttb` request large enough to exceed the cap 413s, while the same data fetched as
bucket-aligned windows (the web `makeWindowedVariant` consumer, Task 7a) succeeds. This is the guard
working as designed; just be aware the API and a tiling client can disagree at the cap boundary. No
action needed beyond ensuring the web variant always tiles (it does, per plan).

---

## Summary

| Sev | Finding |
|-----|---------|
| Medium | M1 — 413 message recommends `bucketSec`, which doesn't reduce the uncapped points rowset |
| Medium | M2 — synchronous reshape of up to 3M rows can stall the event loop; verify cap is measurement-derived |
| Low | L1 — cap comment claims a measurement that should be confirmed/recorded |
| Low | L2 — `processAvg` test helper has confusing leftover comments |
| Low | L3 — informational: full-session-413-vs-windowed-success is by design |

The change is correct and ready once **M1** (one-line message fix) is addressed and **M2/L1** (confirm
the cap is empirically grounded, consider lowering it) are resolved or explicitly accepted by the
author. No correctness, security, or migration blockers found.
