# A1 — Deterministic absolute bucket alignment for windowed aggregation

**Date:** 2026-06-22
**Source:** conversation context — web client moves to progressive windowed aggregated loading

## Key Findings

- The web client (mind_web Phase 21) is switching from a single full-session aggregated request to **progressive time-windowed** requests (`?from&to&bucketSec`) so the chart opens immediately and fills as it streams. For that to be correct, windowed aggregated requests MUST tile seamlessly.
- If `listBiometrics` buckets relative to each request's `from`, adjacent windows would re-bucket from different origins → seams, split buckets, double-counted or missing samples at window edges. The fix is to anchor buckets to a stable ABSOLUTE origin.

## Details

### Requirement
- **Absolute bucket origin.** Bucket index = `floor((sampleTs - ORIGIN) / bucketSec)` where `ORIGIN` is a stable absolute reference (epoch `0`, or `session.startedAt`) — NOT the request's `from`. A given sample falls in the same bucket regardless of which window requested it.
- **Half-open `[from, to)` window semantics.** A sample exactly on a window boundary belongs to exactly one window (mirrors the client's `+1 ms` raw-chunk convention). With absolute buckets + the client aligning window edges to `bucketSec` multiples (`quantizeWindow`), each bucket sits fully inside one window.
- **Tiling guarantee.** N adjacent windowed requests at `bucketSec=B` covering `[startedAt, endedAt]` return the IDENTICAL bucket set (same bucketStart timestamps, same min/max or agg values) as one full-session request at `bucketSec=B`. No seam, no double-count, no missing edge bucket.

### Change
- Inspect `SessionsService.listBiometrics` (the `?bucketSec` aggregation added in Phase 48). If bucketing is `from`-relative, re-anchor to absolute (`session.startedAt` or epoch). If already absolute, this is a verification task.
- Add a test: full-session single aggregation vs N windowed-tiled aggregations over the same range at the same `bucketSec` → byte-equal sample sets.

### Guards / boundary
- No contract shape change — still `?bucketSec` → synthetic `BioSampleDto[]` (the min/max envelope). This task is ONLY about bucket-boundary determinism, not the agg method.
- Independent of the separate smoothed-aggregation endpoint (`agg=avg|lttb`, variant 3) — that is its own milestone; alignment must hold for whatever agg method is used.

## Open Questions

- Origin choice: epoch vs `session.startedAt`. `session.startedAt` keeps bucket timestamps human-meaningful per session; epoch is globally stable. Either works as long as it's request-`from`-independent — pick one and document it.
