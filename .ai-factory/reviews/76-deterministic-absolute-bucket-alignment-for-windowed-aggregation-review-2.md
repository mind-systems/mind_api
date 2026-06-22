# Code Review 2: Deterministic absolute bucket alignment for windowed aggregation

**Plan:** `.ai-factory/plans/76-deterministic-absolute-bucket-alignment-for-windowed-aggregation.md`
**Files reviewed in full:** `src/sessions/biometric-aggregation.util.ts` (new), `src/sessions/biometric-aggregation.util.spec.ts` (new), `src/sessions/sessions.service.ts` (modified, incl. `aggregateBiometrics` + `listBiometrics`), plus `src/realtime/services/biometric-stream-engine.service.ts` (to assess the `flushedAt` caveat).
**Verification run this review:** `npx jest src/sessions/` → 15/15 pass. `npx tsc --noEmit` → no errors in any changed file (the only `tsc` errors live in `src/realtime/services/biometric-stream-engine.service.spec.ts`, an untouched pre-existing file).
**Risk level:** 🟢 Low

## Result
No defects found. The implementation correctly delivers the milestone and addresses the prior review.

- **Review-1 finding resolved.** The locale-dependent `localeCompare` tie-breaker has been replaced with a deterministic code-unit comparison (`sa < sb ? -1 : sa > sb ? 1 : 0`, util lines 134–136), now consistent with the `.sort()` collation used for `data` field keys (line 116). The spec's ordering assertions (`[...x].sort()`) match this comparator.

- **Absolute origin confirmed.** Bucket index is `floor(ts / bucketMs)` in SQL (line 297) and `Math.floor(tsMs / bucketSec*1000)` in `bucketIndexForMs` — both epoch-anchored, `from`-independent. `reshapeAggregateRows` derives `bucketStart` solely from the SQL-returned bucket index, never recomputing it, so the JS↔SQL float-vs-numeric distinction cannot affect production output.

- **Determinism fix is real and on the production path.** `reshapeAggregatedBiometrics` delegates to `reshapeAggregateRows`, which applies a total `(timestamp, sampleType)` sort and sorted `data` keys — eliminating the timestamp-tie insertion-order dependence and the row-order key dependence flagged in plan-review 1. Min-before-max is intrinsic via the `bucketSec*500` offset (always < the next bucket start), so the two-field tuple is genuinely total. The added `ORDER BY` is correctly described as redundant-but-clarifying.

- **Half-open `[from, to)` semantics** are intact on both the raw and aggregated paths; the spec's boundary-sample test confirms an edge sample lands in exactly one window.

- **Tests are faithful and pass:** byte-equal full-vs-tiled for single and multiple sampleTypes, the multi-sampleType same-`bucketStart` tie case (the one that broke before), boundary/no-seam, `from`-independence (`[B,3B)` vs `[0,4B)`), single-sample-per-bucket, and key-ordering determinism.

## Security & runtime checks
- **No SQL injection.** Every user-influenced value (`session.id`, `from`, `to`, `bucketSec*1000`, garbage bound) is bound via the `p()` parameterizer (`$1…$n`); nothing is string-interpolated into the SQL. `bucketSec` is validated `@IsInt() @Min(1)` at the DTO.
- **No migration needed** — no schema change. Correct.
- **No race conditions** — the new helpers are pure and stateless.
- **Type safety** — `reshapeAggregatedBiometrics`' row type (`{sampleType,bucket,field,min,max}` as strings) matches `AggregateRow`; `Number(row.*)` tolerates the pg driver's string-encoded numerics.

## Informational (non-blocking, no action required)
- **`flushedAt` caveat is adequately scoped.** The in-code caveat attributes window/full divergence to clock skew. I verified the flush interval defaults to 5s (`BIO_STREAM_FLUSH_INTERVAL_MS`, engine line 52–55) vs the 120s `FLUSHED_AT_PAD_MS` pad — so under normal operation `flushedAt` sits ~5s after capture and the coarse filter never drops in-window samples. Divergence beyond the pad requires ~2 min of client/server clock skew, exactly the documented out-of-scope case. The same coarse filter already governs the pre-existing raw path, so this change introduces no new exposure.
- **SQL↔helper equivalence remains comment-guarded, not test-guarded.** The optional Postgres-backed e2e (plan Task 5) was not added, so the JS `aggregateRawSamples` mirror and the SQL aggregation could in principle drift on a future SQL edit. This matches the plan's stated DB-less limitation and the lockstep comment is in place; worth keeping the e2e on the backlog.

REVIEW_PASS
