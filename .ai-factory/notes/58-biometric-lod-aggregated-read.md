# Biometric LOD — aggregated read for long-session charts (server-side downsampling)

**Date:** 2026-06-21
**Source:** conversation context (mind_web perf triage; API/storage owner review)

## Key Findings

- The web chart freeze on 30 min+ sessions is fixed **client-side** by display decimation (mind_web notes 28-31), but those do **not** reduce what the client loads/holds — it still fetches every raw sample of the session. Removing the raw memory/network footprint when zoomed out requires the **server** to return a coarse resolution. That is this milestone.
- **Storage reality** (confirmed against Phase 19 + Phase 21): biometrics live as `bio_session_samples.samples` — a **jsonb array per flush**. `GET /sessions/runs/:id/biometrics` (`SessionsService.listBiometrics`) selects rows by the `flushedAt` window ordered ASC and flattens `row.samples` into `{ timestamp, sampleType, data }[]`. There is **no per-sample row and no per-field column** — `data` is **opaque, producer-owned jsonb** (mobile owns the schema; the server does not know the field set: `heartRate`, EEG bands, emotions, motion axes).
- **Data shape — confirmed against the live DB (860 067 samples).** Despite the opaque contract, every sample is a *flat* `{ timestamp(ms), sampleType, data }` where `data` is a flat object of **numeric scalars + a few bool/string tags** — no nesting, no arrays, stable key set per `sampleType`: `cardio.heartRate`, `nfb.{delta,theta,alpha,smr,beta}`, `emotions.{attention,relaxation,cognitiveLoad,cognitiveControl,selfControl}`, `motion.{ax,ay,az,gx,gy,gz}`, `rr.intervalMs` (+ non-numeric tags `source`/`hasArtifacts`/`isArtifact`/`metricsAvailable`). `jsonb_typeof` cleanly separates numeric leaves from tags.
- **Opaque aggregation IS possible without knowing the schema** — bucket by *value type*, not field name: `jsonb_each(elem->'data')` filtered on `jsonb_typeof(value)='number'`, then `min`/`max` per `(sampleType, key, floor(ts/bucket))`; non-numeric tags ignored or last-valued. The server never hardcodes a producer field, and a new numeric field is picked up automatically. This **dissolves the "generic-key gymnastics vs hardcoded field list" dilemma** — there is a clean schema-agnostic path, so the read-path aggregation is not contract-leaky.
- **Scale is driven almost entirely by `motion`** — 816 825 of 860 067 samples (~95 %); worst single session = **389 720** motion samples. Non-motion is small (cardio ~10k, nfb/emotions ~15k each, rr ~3k total). So on-the-fly aggregation is cheap for typical sessions; only motion-class sessions are heavy — a perf risk to **measure**, not a reason to pre-build anything.
- Therefore the substance is the **aggregation query over opaque nested jsonb**, not a trivial `?bucketSec=` wire-up — but the type-driven mechanism above makes it tractable directly in the read path.
- **Contract ownership:** the biometrics read is mind_api-owned (`mind_api/proto`+REST is the source of truth). Any new param / response shape for aggregated reads starts here; mind_web consumes it (web note 32).

## Details

### Requirement
- Given a zoom span, the client must request biometrics at a resolution matched to the span: the full session at a coarse `bucketSec` when zoomed out (small payload, single request, no per-chunk 413 dance), raw samples when zoomed in (existing chunked path).
- The envelope must **preserve spikes**: per bucket, per field, return **min and max** (client renders a min/max envelope — mirrors the `sampling:'minmax'` decision in web note 28). The settled (i) shape carries **min and max only** (the 2 synthetic samples) — **no `avg`, no 3rd sample**.
- **Empty buckets:** if a bucket has no samples of a given `sampleType`, emit nothing for it (leave a gap). Do **not** zero-fill — a zero bucket draws a false crash-to-zero across pause/disconnect gaps.

### Approach — on-the-fly read-time aggregation
`SessionsService.listBiometrics` gains a `bucketSec` branch: `jsonb_array_elements(samples)` + `jsonb_each(data)` filtered on `jsonb_typeof='number'` + bucket by `floor(ts / (bucketSec*1000))`, aggregating `min`/`max` per `(sampleType, key, bucket)`. **Schema-agnostic** (type-driven — no field-name coupling). Computed **per request — no new table, no write path, no cache, no migration**: a pure read-time transform in the serving layer, no module boundary crossed. The one risk is **CPU**: a motion-heavy full-session zoom-out unnests ~390k jsonb leaves per request — measure it (Open Questions); do **not** pre-build storage for a cost not yet observed.

### Contract
- `GET /sessions/runs/:id/biometrics?from&to&bucketSec=<n>` — `bucketSec` omitted ⇒ today's raw behavior, byte-for-byte (backward compatible). Present ⇒ aggregated response.
- **Response shape — SETTLED with web (note 32): option (i).** Keep `BioSampleDto[]`; per bucket per `sampleType` emit **exactly 2 synthetic samples** so the web's existing `toSeries(field)` / note-30 pipeline is reused unchanged (overview ↔ raw visually identical, same minmax semantics). (ii) is dropped. Two server-side obligations the web depends on:
  - **Distinguishable timestamps + fixed order inside the bucket.** min-sample at `timestamp = bucketStart`, max-sample at `bucketStart + bucketSec*500` (ms — bucket midpoint; `bucketSec*500` because the column is epoch-ms and `bucketSec` is seconds). Without distinct x the line degenerates to vertical segments. This is the standard single-series minmax-envelope look (one polyline zigzags min→max→next-min), **not** separate upper/lower series.
  - **Each synthetic sample carries ALL numeric keys of its `sampleType`** — the min-sample's `data` = `{ field → bucket-min }` for every numeric field, the max-sample's `data` = `{ field → bucket-max }`. Non-numeric tags (`source`/booleans) are omitted (the web charts only numeric fields). Field-wise extrema are packed into one synthetic sample even though they occur at different real instants — fine for an envelope; `toSeries(field)` reads each field independently.
- **Not the web's concern (kept on our side):** `?bucketSec` selection per zoom span, the raw↔aggregated switch threshold, and overview-on-mount are web policy (their `RAW_SPAN_LIMIT`/`snapUp` in note 32). We only honor `bucketSec` as given.

### Guards
- `data` stays **opaque** — aggregate the numeric leaves via `jsonb_typeof='number'` (type-driven); do not hardcode the producer's field names into a fixed-column aggregation.
- **Filter garbage timestamps when bucketing.** The DB carries stray `timestamp=0` samples (2 in 860 067 — not systemic, a first-frame origin glitch, *not* the fixed Phase-32 Long bug; all timestamps are clean scalar integers now). A single `0` still poisons a min/max-by-bucket: it creates a phantom bucket at epoch 0 that stretches the x-axis. Bound `timestamp` to a sane range (e.g. `> startedAt − slack`) in the bucket query. Cheap defense against single outliers — not a data-cleanup project.
- Backward compatible: no `bucketSec` ⇒ identical to today. 413 guard on the raw path intact.

## Open Questions

- **Perf:** does on-the-fly aggregation hold up on the 389k-motion session (`dc8b6de1-…`)? Measure before shipping. If it turns out too heavy, raise it then — do **not** pre-build storage/caching for a cost not yet observed.
- **(Resolved)** Aggregating an opaque field set without schema coupling — type-driven `jsonb_each` + `jsonb_typeof='number'` (see Key Findings).
- **(Resolved with web note 32)** Response shape = (i) synthetic min/max `BioSampleDto`, 2/bucket, with the placement + all-numeric-keys obligations in Contract above.
