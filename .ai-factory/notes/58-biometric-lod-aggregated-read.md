# Biometric LOD — aggregated read for long-session charts (server-side downsampling)

**Date:** 2026-06-21
**Source:** conversation context (mind_web perf triage; API/storage owner review)

## Key Findings

- The web chart freeze on 30 min+ sessions is fixed **client-side** by display decimation (mind_web notes 28-31), but those do **not** reduce what the client loads/holds — it still fetches every raw sample of the session. Removing the raw memory/network footprint when zoomed out requires the **server** to return a coarse resolution. That is this milestone.
- **Storage reality** (confirmed against Phase 19 + Phase 21): biometrics live as `bio_session_samples.samples` — a **jsonb array per flush**. `GET /sessions/runs/:id/biometrics` (`SessionsService.listBiometrics`) selects rows by the `flushedAt` window ordered ASC and flattens `row.samples` into `{ timestamp, sampleType, data }[]`. There is **no per-sample row and no per-field column** — `data` is **opaque, producer-owned jsonb** (mobile owns the schema; the server does not know the field set: `heartRate`, EEG bands, emotions, motion axes).
- Therefore "min/max/avg buckets" is **NOT a cheap query param**. This is a storage-aware milestone, not a `?bucketSec=` bolt-on. The substance is the strategy fork below — resolve via `/aif-plan` on the API side before implementing.
- **Contract ownership:** the biometrics read is mind_api-owned (`mind_api/proto`+REST is the source of truth). Any new param / response shape for aggregated reads starts here; mind_web consumes it (web note 32).

## Details

### Requirement
- Given a zoom span, the client must request biometrics at a resolution matched to the span: the full session at a coarse `bucketSec` when zoomed out (small payload, single request, no per-chunk 413 dance), raw samples when zoomed in (existing chunked path).
- The envelope must **preserve spikes**: per bucket, per field, return **min and max** (client renders a min/max envelope — mirrors the `sampling:'minmax'` decision in web note 28). `avg` optional for a center line.

### Strategy fork (the decision this milestone exists to make)
- **(A) On-the-fly** — `jsonb_array_elements(samples)` unnest + `date_trunc`/bucket + per-field aggregation, computed on each request. Heavy over nested jsonb for a zoomed-out full-session read; the field set is **dynamic**, so the SQL is either generic-key gymnastics or a fixed known-field list (which couples the server to the opaque producer schema — a design smell). Likely too slow and/or contract-leaky.
- **(B) Precomputed rollup** — materialize a downsampled structure (e.g. `bio_session_rollup(moduleSessionId, sampleType, bucketSec, bucketStart, field, min, max, avg)`, or a compact jsonb-per-bucket) at **session finalization** (the engines already flush, and the lifecycle has clear finalize/abandon events — Phases 18/24/42). The read path then serves the rollup directly. Costs: extra storage, a finalize-time job, and a backfill / on-first-read materialization for sessions finalized before the feature existed.

### Contract sketch (finalize in /aif-plan)
- `GET /sessions/runs/:id/biometrics?from&to&bucketSec=<n>` — `bucketSec` omitted ⇒ today's raw behavior, byte-for-byte (backward compatible). Present ⇒ aggregated response.
- Response shape options: **(i)** keep `BioSampleDto[]` but emit 2 synthetic samples per bucket per sampleType (one carrying per-field minima, one per-field maxima) so the existing web `toSeries(field)` keeps working unchanged; or **(ii)** a distinct aggregated DTO `{ bucketStart, sampleType, field, min, max, avg }[]` (cleaner, needs a new client transform). (i) minimizes client churn — coordinate with web note 32.

### Guards
- `data` stays **opaque** — do not hardcode the producer's field names into a fixed-column aggregation unless the rollup design explicitly accepts and documents that coupling.
- Backward compatible: no `bucketSec` ⇒ identical to today. 413 guard on the raw path intact.

## Open Questions

- Strategy **A vs B** — the milestone's core decision; drives schema, perf, migration, and backfill.
- Response shape **(i) synthetic samples vs (ii) aggregated DTO** — coordinate with web note 32.
- How to aggregate over a **dynamic/opaque** field set without coupling the server to the mobile schema.
- Backfill for sessions finalized before the rollup exists (strategy B).
