# C1 — Biometric aggregation `agg=avg` mode + extensible reducer dispatch

**Date:** 2026-06-22
**Source:** conversation context — mind_web Phase 22 smoothing testbed; one API layer, many algorithms

## Key Findings

- `SessionsService.listBiometrics` (`src/sessions/sessions.service.ts`) Phase 48 supports `?bucketSec=<n>` → per-bucket per-field **min+max** (2 synthetic `BioSampleDto`/bucket, api note 58). That envelope is spike-preserving but renders as a sawtooth (one polyline min→max→min). The web testbed (mind_web Phase 22) compares smoothing algorithms **all through this one endpoint**, selecting the algorithm with a query param.
- The aggregation is already schema-agnostic (`jsonb_array_elements` + `jsonb_each` filtered on `jsonb_typeof(value)='number'`, bucketed by `floor(ts/(bucketSec*1000))`). `avg` is a trivial reducer swap emitting **ONE** synthetic sample/bucket. The branch should be a **strategy dispatch keyed by `agg`** so future algorithms (`lttb`, `median`, …) are a small addition — server reducer + one web registry radio.

## Details

### Change
- Add optional **`agg`** query param to `GET /sessions/runs/:id/biometrics` (∈ `minmax` (default == unset) | `avg`). Validate; unknown value → `400`. `bucketSec` absent ⇒ raw, byte-for-byte (unchanged).
- **Dispatch** in `listBiometrics`: `agg` unset/`minmax` → the existing 2-sample min/max envelope; `agg=avg` → per `(sampleType, bucket)` **one** synthetic `BioSampleDto`: `timestamp = bucketStart + bucketSec*500` (bucket midpoint, ms — centered, no x-degeneration), `sampleType`, `data = { field → avg(value) }` over every numeric leaf; non-numeric tags omitted.
- **Preserve the all-numeric-keys-per-synthetic-sample contract** (note 58) so the web `toSeries(field)` pipeline is unchanged — one sample/bucket carries every field's average.
- **Absolute bucket anchoring** (Phase 49): bucket against the stable epoch grid, not each request's `from`, so windowed `agg=avg` requests tile seamlessly (the web loads progressively in windows).

### Web consumer (cross-project completion — ship API first)
- mind_web appends one registry entry (Phase 22 A2 factory handles the rest): `CHART_VARIANTS += makeWindowedVariant({ id: 'avg', label: 'Average', windowSec: <bucket-aligned>, buildPath: …&bucketSec=N&agg=avg })`. No other web change.

### Guards
- `data` stays **opaque** — type-driven (`jsonb_typeof='number'`), no field-name coupling; a new numeric field is averaged automatically.
- Back-compat: `agg` absent ⇒ byte-identical min/max. Skip empty buckets (no zero-fill — a zero draws a false crash across pause/disconnect gaps). Filter stray `timestamp=0` (note 58 guard). 413 raw path intact.
- **Measure CPU** on the 389k-motion session (`dc8b6de1-…`): `avg` is one pass over the same unnest — should be ≤ the min/max cost; confirm, don't pre-optimize.

### Verify
- `?bucketSec=N&agg=avg` → one sample/bucket, all numeric fields averaged. N windowed requests == one full request at the same `bucketSec` (Phase 49 tiling). Web "Average" radio renders a smooth (non-sawtooth) line.

## Open Questions
- `timestamp` placement bucketStart vs midpoint — midpoint chosen for a centered look; confirm against the web rendering. Depends on Phase 48 (jsonb aggregation) + Phase 49 (absolute alignment).
</content>
