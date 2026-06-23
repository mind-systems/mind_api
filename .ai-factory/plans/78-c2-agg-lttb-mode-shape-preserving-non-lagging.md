# Plan: (C2) `agg=lttb` mode (shape-preserving, non-lagging)

## Context
Add a third bucketed biometric aggregation mode, `agg=lttb`, that downsamples each numeric
field to one representative point per `bucketSec` bucket while **keeping spikes** (unlike `avg`
flattening) and **without trailing-MA lag**. Depends on C1 (the `agg` param + `AGG_REGISTRY`
dispatch already exist in `biometric-aggregation.util.ts` / `sessions.service.ts`).

## Key Design Decision (read before implementing)

C1's `minmax`/`avg` modes compute one Postgres `GROUP BY` aggregate per `(sampleType, bucket,
field)`. Each bucket's value depends **only** on points inside that bucket, so windowed requests
tile byte-equal to the full session for free, and only a small aggregated rowset returns to Node.

Classic LTTB is **not** bucket-local: each bucket's pick depends on the *previously-selected*
point and the *next bucket's centroid*. Under this project's no-halo windowing model — the
service filters samples to `[from, to)` first, then aggregates (see the existing tiling spec
`process()` helper) — any cross-bucket dependency would make a window's edge bucket pick a
**different** representative than the full-session run, breaking the **byte-equal tiling gate**
that this milestone must pass.

Therefore the implemented variant is **bucket-local LTTB** (resolves the open question in spec
note 61, lines 29–30): for each `(sampleType, field, bucket)`, the triangle anchors are the
bucket's **own first and last point by timestamp** (the chord), and the representative is the
in-bucket point with the largest triangle area against that chord — i.e. the point that deviates
most from the bucket's endpoint chord (the spike). This is symmetric (non-lagging),
shape-preserving, fully bucket-local (tiles byte-equal), and per-field independent.

> **Naming note (divergence from ROADMAP/spec wording):** ROADMAP C2 and note 61 describe classic
> LTTB ("triangle with the previously-selected point and the next bucket's centroid"). Here `lttb`
> means **bucket-local triangle vs the bucket's own first/last chord**, chosen deliberately to keep
> the byte-equal tiling gate. The artifact name and the future web radio still read "LTTB". This is
> a recorded decision, not silent drift — Task 7b annotates note 61 / ROADMAP so a future reader
> reconciling the two sees the rationale.

Pinned selection rule (deterministic) for one `(sampleType, field, bucket)` group:
- Points are the numeric `(ts, value)` pairs for that field in that bucket, sorted by `(ts, value)`.
- `0` points → bucket produces no field entry (skip-empty, same as C1).
- `1` point → that point's value.
- `≥2` points → `A` = first point, `C` = last point (by sorted order); for each candidate `P`,
  `area = |(C.ts − A.ts)·(P.value − A.value) − (P.ts − A.ts)·(C.value − A.value)|`
  (the `/2` is omitted — monotonic, doesn't affect argmax). Pick the max-area point.
  If all areas are `0` (e.g. exactly 2 points, or collinear), fall back to the point with the
  largest `|value − bucketMean|`. Final tie-break: earliest `ts`, then smallest `value`.

Known, accepted limitation of this variant (document in the impl, do not "fix"): a spike that
**is** the bucket's first or last point sits on the chord (area 0) and is not selected unless every
area is 0; a near-monotonic bucket whose extreme is on an edge maps to a less-extreme interior
point. Acceptable for a comparison testbed — note it so QA doesn't file it as a bug.

Packing (mirror `reshapeAvgRows`): one synthetic record per `(sampleType, bucket)` →
`{ timestamp: bucketStart + bucketMidpointOffsetMs, sampleType, data: { field → selectedValue } }`,
`data` keys in sorted order, result sorted by `(timestamp, sampleType)`. The selected point's real
x is intentionally replaced by the bucket midpoint (same as `avg`, note 61 line 30) — tests assert
on the selected **value**, never its timestamp.

Invariants reused from C1 unchanged: absolute (epoch-0) bucket anchoring, skip-empty buckets,
garbage-timestamp filter (`> garbageBound`, the spec's "filter 0"), half-open `[from, to)` window.

### Resource guard (must ship with the path, not after)
Unlike the grouped path (which returns a small aggregate), the `lttb` `'points'` path transfers
**~one row per `(sample element, numeric field)`** from Postgres into Node — on the order of 1–2M
rows for the 389k-motion session. `aggregateBiometrics` currently has **no** `ROW_CAP`/413 guard,
justified only because the grouped rowset is provably small (service comment lines 228–232). The
`'points'` path breaks that premise and would be reachable from the public endpoint the moment the
DTO accepts `lttb` and the dispatch is wired. A plain `ROW_CAP` (60k) cannot be reused — the
**intended** 389k-session workload legitimately exceeds it. So the `'points'` path gets a dedicated
`LTTB_POINTS_ROW_CAP` sized from the Task 6 measurement (comfortably above the largest real session,
below pathological OOM territory), enforced via `LIMIT cap+1` → `PayloadTooLargeException`. The guard
and its measurement-derived cap both land in Commit 1, before the endpoint is reachable.

## Settings
- Testing: yes (extend the existing `biometric-aggregation.util.spec.ts` — tiling is a hard gate)
- Logging: minimal
- Docs: no (only the divergence annotation in note 61 / ROADMAP — Task 7b)

## Tasks

### Phase 1: Contract

- [x] **Task 1: Accept `lttb` in the agg contract**
  Files: `src/sessions/biometric-aggregation.util.ts`, `src/sessions/dto/time-range-query.dto.ts`
  Extend `AggMode` union to `'minmax' | 'avg' | 'lttb'`. In `TimeRangeQueryDto`, change the `agg`
  validator to `@IsIn(['minmax', 'avg', 'lttb'])`. No behavior change yet — this ships together with
  Tasks 2–6 in Commit 1, so the endpoint never accepts `lttb` without the guarded dispatch behind it.

### Phase 2: LTTB aggregation core (pure util)

- [x] **Task 2: Implement bucket-local LTTB reshape + reference point collector** (depends on Task 1)
  Files: `src/sessions/biometric-aggregation.util.ts`
  Add:
  - `interface LttbRow { sampleType: string; bucket: string; field: string; ts: string; value: string; }`
    (raw per-point rows as Postgres returns them — all string-encoded, mirroring `AggregateRow`).
  - `reshapeLttbRows(rows, bucketSec)`: group rows by `(sampleType, bucket, field)`, parse `ts`/`value`
    to numbers, sort each group's points by `(ts, value)`, run the pinned selection rule above to pick
    one value per field, then pack one synthetic sample per `(sampleType, bucket)` exactly like
    `reshapeAvgRows` (sorted `data` keys, midpoint timestamp via `bucketMidpointOffsetMs`, final
    `(timestamp, sampleType)` sort). Reuse `bucketStartMs` / `bucketMidpointOffsetMs`. Add a doc
    comment recording the accepted spike-at-endpoint limitation from the Key Design Decision.
  - `collectRawPoints(samples, bucketSec, fromMs?, toMs?, garbageBoundMs?): LttbRow[]`: the in-memory
    reference that mirrors the points SQL (Task 4) the same way `aggregateRawSamples` mirrors the
    grouped SQL — same garbage + half-open filters, iterate numeric leaves via `typeof value ===
    'number'`, emit one row per `(sampleType, bucket, field, ts, value)` with all values stringified.
    Used by tests only.
  Respect project RULES: no non-null assertions; explicit guards on optional values.

- [x] **Task 3: Register `lttb` and generalize the registry entry shape** (depends on Task 2)
  Files: `src/sessions/biometric-aggregation.util.ts`
  Add a `kind: 'grouped' | 'points'` field to each `AGG_REGISTRY` entry (`minmax` and `avg` →
  `'grouped'`). Add the `lttb` entry: `kind: 'points'`,
  `selectColumns: "(elem->>'timestamp')::numeric AS ts, " + NUMERIC_LEAF + " AS value"`,
  `reshape: (rows, bucketSec) => reshapeLttbRows(rows as unknown as LttbRow[], bucketSec)`.
  Update the registry type so `kind` is part of the entry contract.

### Phase 3: Service dispatch + resource guard

- [x] **Task 4: Branch `aggregateBiometrics` on registry `kind`, with a bounded points path** (depends on Task 3)
  Files: `src/sessions/sessions.service.ts`
  The shared WHERE conditions, params, and `floor(ts/bucketMs) AS bucket` expression stay identical
  (this is what guarantees the same filtering as `avg`). Branch only the SELECT/GROUP/ORDER tail by
  `strategy.kind`:
  - `'grouped'` (current behavior, unchanged): `... ${strategy.selectColumns} ... GROUP BY
    "sampleType", bucket, field ORDER BY "sampleType", bucket, field`.
  - `'points'`: `SELECT elem->>'sampleType' AS "sampleType", floor(...) AS bucket, kv.key AS field,
    ${strategy.selectColumns}` (no GROUP BY). **No `ORDER BY`** — `reshapeLttbRows` re-sorts each
    group by `(ts, value)` in JS, so an SQL sort over the full (large) raw rowset is wasted work;
    omit it. Apply `LIMIT ${LTTB_POINTS_ROW_CAP + 1}`.
  - Add a new module constant `LTTB_POINTS_ROW_CAP` (next to `ROW_CAP`/`FLAT_CAP`). After the points
    query, if `rows.length > LTTB_POINTS_ROW_CAP` throw `PayloadTooLargeException` (mirror the raw
    path's 413 contract). Initial cap value is set from the Task 6 measurement of the 389k-motion
    session with headroom; until then use a conservative placeholder and finalize in the same commit.
  Keep the lockstep comment between the SQL `floor(...)` and `bucketIndexForMs`. Update the
  service comment at lines 228–232 so it no longer claims "no ROW_CAP needed" unconditionally — that
  holds for `'grouped'` only; `'points'` is explicitly capped.

### Phase 4: Tests

- [x] **Task 5: Extend the aggregation spec for lttb** (depends on Task 2, Task 4)
  Files: `src/sessions/biometric-aggregation.util.spec.ts`
  Add an `lttb` describe block mirroring the existing helpers (add a `processLttb()` that does
  `reshapeLttbRows(collectRawPoints(...), bucketSec)`). Cover:
  - **Tiling byte-equality**: full session === concatenation of N bucket-aligned adjacent windows
    (the existing critical gate), including the multi-`sampleType` shared-`bucketStart` ordering case.
  - **Determinism**: identical output regardless of input sample order.
  - **Spike preservation vs avg**: a bucket with a clear interior spike → `lttb` keeps the spike value
    while `avg` flattens it. Assert on the selected **value**, not its timestamp (midpoint stamping).
  - **Edge cases**: single-point bucket; two-point bucket (area-0 fallback to max `|value − mean|`).

### Phase 5: Measurement-derived cap

- [x] **Task 6: Measure CPU / payload on the 389k-motion session and size the cap** (depends on Task 4)
  Files: `src/sessions/sessions.service.ts` (finalize `LTTB_POINTS_ROW_CAP` value only)
  Run `agg=lttb` against the 389k-motion session. Record: the points-query row count (to set
  `LTTB_POINTS_ROW_CAP` above it with headroom), query + Node reshape time, and response size vs
  `agg=avg`. Confirm the result renders a smooth line that keeps HR/EEG spikes. Set the final cap so
  the legitimate 389k workload passes and pathological requests still 413.
  **Fallback (only if even the capped workload is too slow):** switching SQL to return only the
  per-bucket value-min/value-max candidate points is **a different, lower-fidelity algorithm** — the
  max-triangle-area point against the chord is generally neither the value-min nor the value-max, so
  this would change selected values and **invalidate the Task 5 tiling and spike tests**, which must
  then be re-derived. It is not a free transfer optimization. Do not adopt it pre-emptively (note 58);
  the `LTTB_POINTS_ROW_CAP` guard is the primary safety mechanism.

### Phase 6: Cross-project / documentation follow-up

- [ ] **Task 7a: mind_web LTTB chart variant** (depends on Task 4 — ship API first)
  Files: `mind_web` chart-variants registry (Phase 22 A2 `makeWindowedVariant` factory)
  Apply **in the `mind_web` repo** (out of scope for the `mind_api` commits): append one entry
  `makeWindowedVariant({ id: 'lttb', label: 'LTTB', windowSec: <bucket-aligned>, buildPath:
  …&bucketSec=N&agg=lttb })` so a "LTTB" radio appears alongside Raw / Min-max / Average. No other
  web change. Handoff item — do not edit `mind_web` from the `mind_api` working tree.

- [x] **Task 7b: Record the bucket-local divergence in the spec note / ROADMAP**
  Files: `.ai-factory/notes/61-biometric-agg-lttb-mode.md`, `.ai-factory/ROADMAP.md` (C2 entry)
  Add one line stating that the shipped `lttb` is **bucket-local** (triangle vs the bucket's own
  first/last chord), chosen to preserve the byte-equal tiling gate, which resolves note 61's Open
  Question (line 29). Keeps the "LTTB" label honest for future readers.

## Commit Plan
- **Commit 1** (tasks 1-6): "Add lttb bucket-local aggregation mode to biometric queries"
  — the `lttb` DTO value, util reshape, registry entry, service dispatch, the
  `LTTB_POINTS_ROW_CAP` guard with its measurement-derived value, and the spec tests all land
  together so the endpoint is never reachable without a guarded, tested path behind it.
- **Commit 2** (task 7b): "Note bucket-local lttb variant in spec note and roadmap"
- Task 7a lands as a separate commit in the `mind_web` repository.
