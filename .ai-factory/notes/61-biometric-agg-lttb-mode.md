# C2 — Biometric aggregation `agg=lttb` mode (shape-preserving downsample)

**Date:** 2026-06-22
**Source:** conversation context — mind_web Phase 22 smoothing testbed; non-lagging, spike-preserving option

## Key Findings

- `agg=avg` (C1) smooths but flattens spikes; the user wants to also compare a **non-lagging, shape-PRESERVING** smoother. LTTB (Largest-Triangle-Three-Buckets) downsamples a series to N points while keeping its visual shape (peaks/troughs survive) — and, unlike a trailing moving average, it does **not lag** (the handoff's hard requirement: a lagging MA will be rejected).
- LTTB is a per-series *selection* algorithm needing `(x, y)` per point. Biometrics are multi-field per `sampleType`, so LTTB runs **per numeric field** (each field is its own series). It still fits the one-synthetic-sample-per-bucket shape: emit one sample/bucket/`sampleType` whose `data = { field → LTTB-selected value for that field in that bucket }`.

## Details

### Change
- Extend the C1 `agg` dispatch with **`agg=lttb`**. For each `(sampleType, field)`: run LTTB over the field's points using the existing `bucketSec` grid as the bucket boundaries → one representative value per bucket. Pack per-field selected values into one synthetic `BioSampleDto`/bucket (`timestamp = bucket midpoint`, all numeric keys — same envelope shape as `avg`). Schema-agnostic (iterate numeric leaves via `jsonb_typeof='number'`).
- **LTTB-over-fixed-buckets variant:** classic LTTB chooses buckets adaptively; here buckets are fixed by `bucketSec`, so per bucket pick the point maximizing the triangle area formed with the previously-selected point and the next bucket's centroid (standard LTTB with fixed bucket edges). Document the exact variant in the impl.
- **Absolute bucket anchoring** (Phase 49) + skip empty buckets + filter `timestamp=0` — same invariants as C1, so windowed `lttb` tiles seamlessly.

### Web consumer (cross-project completion — ship API first)
- mind_web appends one registry entry: `CHART_VARIANTS += makeWindowedVariant({ id: 'lttb', label: 'LTTB', windowSec: <bucket-aligned>, buildPath: …&bucketSec=N&agg=lttb })`. No other web change (Phase 22 A2 factory).

### Guards
- `data` opaque; per-field independent selection (no field-name coupling). **Non-lagging** — LTTB is symmetric (uses the next bucket), not trailing. Back-compat (`agg` absent ⇒ min/max). Depends on **C1** (the `agg` param + dispatch must exist first).
- **Measure CPU** on the 389k-motion session — LTTB per field is heavier than `avg`; if too slow, raise it then (don't pre-optimize, per note 58).

### Verify
- `agg=lttb` renders a smooth line that **keeps** HR/EEG spikes (visually vs `avg` flattening them). Windowed tiling byte-equal to the full-session request. Web "LTTB" radio present alongside Raw / Min/max / Average.

## Open Questions
- Exact LTTB-within-fixed-buckets variant (triangle vs next-centroid choice).
- Per-field independent selection emits field-misaligned real x — resolved by stamping all fields at a shared bucket-midpoint `timestamp` (envelope semantics); confirm this reads acceptably vs keeping each field's real selected x.
</content>
