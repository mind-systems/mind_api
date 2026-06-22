# Code Review: Deterministic absolute bucket alignment for windowed aggregation

**Plan:** `.ai-factory/plans/76-deterministic-absolute-bucket-alignment-for-windowed-aggregation.md`
**Files reviewed (in full):** `src/sessions/biometric-aggregation.util.ts` (new), `src/sessions/biometric-aggregation.util.spec.ts` (new), `src/sessions/sessions.service.ts` (modified), plan + plan-review 1/2.
**Verification run:** `npx jest` on both sessions specs → 15/15 pass. `npx tsc --noEmit` → no errors in any changed file (the 3 reported errors are pre-existing in `src/realtime/services/biometric-stream-engine.service.spec.ts`, which this change does not touch).
**Risk level:** 🟢 Low

## Summary
The change does exactly what the plan and plan-review demanded:
- Bucketing is confirmed epoch-anchored (`bucketIndexForMs = floor(tsMs / bucketSec*1000)`) and half-open `[from, to)` — no re-anchoring needed, correctly identified.
- The real fix — production output non-determinism — is addressed: `reshapeAggregatedBiometrics` now delegates to the shared pure `reshapeAggregateRows`, which applies a **total** `(timestamp, sampleType)` sort and **sorted `data` key order**, eliminating the timestamp-tie insertion-order dependence flagged in plan-review 1. A redundant-but-clarifying `ORDER BY "sampleType", bucket, field` was added to the SQL.
- Production and the regression test share the exact same reshape function, so the thing under test *is* the production reshape path.
- Documentation (epoch origin, half-open, tiling contract, `flushedAt` caveat, SQL↔helper lockstep) is present in both the util and the service.
- No schema change → no migration required (correct). No new logging, no rule violations (no `!`, no PII logged).

The byte-equal tiling tests are well-constructed: bucket-aligned windows, multi-sampleType same-`bucketStart` tie case, half-open boundary sample, `from`-independence (`[B,3B)` vs `[0,4B)`), and key-order determinism. The math checks out — the max-sample offset (`bucketSec*500` = half-bucket) is always strictly less than the next bucket's start, so per-bucket output ranges are temporally disjoint and window concatenation equals the sorted full result.

## Findings

### Low — `localeCompare` is a locale/ICU-dependent comparator, inconsistent with the `.sort()` used for field keys
`reshapeAggregateRows` (util line 134) breaks timestamp ties with:
```ts
return (a['sampleType'] as string).localeCompare(b['sampleType'] as string);
```
while field keys are ordered with default `Object.keys(...).sort()` (code-unit order, line 116). Two issues, both low impact:
1. `localeCompare()` with no locale argument depends on the runtime's default locale and ICU build. The milestone's guarantee (N windowed requests byte-equal to one full request) holds regardless, since all those requests run in the *same* process with the same locale — so this is **not** a correctness break for the stated contract. It is a robustness smell against the file's own "globally stable byte-equal output" claim and is internally inconsistent with the `.sort()` collation used two lines up.
2. The test asserts ordering with `[...sameTypes].sort()` (spec line 84) — code-unit order — which only coincidentally matches `localeCompare` for the lowercase-ASCII sampleTypes used (`alpha`/`beta`). For uppercase or non-ASCII sampleType values the test's expectation and production's ordering could diverge, so the test isn't pinning the exact production order it appears to.

Suggested: use one deterministic comparator for both (e.g. `a < b ? -1 : a > b ? 1 : 0`) for sampleType and keep `.sort()` for keys consistent with it. Non-blocking.

## Informational (not defects)
- **SQL aggregation path is not exercised by an automated test.** The shared `reshapeAggregateRows` is covered, but the half-open filter + bucket-index *as executed by Postgres* is only mirrored by the JS `aggregateRawSamples`, never run against a DB. This is the known DB-less limitation called out in the plan (optional Task 5 e2e, skipped). The new lockstep comment in `sessions.service.ts` is the only guard that the SQL `floor(ts/bucketMs)` stays equal to `bucketIndexForMs`. Acceptable per plan; worth keeping the e2e test on the backlog so a future SQL edit can't silently drift.
- **Numeric round-tripping** (`Number(pgNumericString)` in production vs `String(jsNumber)` in the test) does not threaten production byte-equality: full-session and windowed requests both go through the identical SQL→`Number()` path over the same underlying values, so they produce identical strings.

## Verdict
Correct, well-tested, and faithful to the plan and both plan-reviews. The single finding is low-severity and non-blocking. Recommend addressing the `localeCompare` consistency nit opportunistically.
