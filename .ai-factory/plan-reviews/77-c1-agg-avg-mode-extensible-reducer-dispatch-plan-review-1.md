# Plan Review — (C1) `agg=avg` mode + extensible reducer dispatch

**Plan:** `77-c1-agg-avg-mode-extensible-reducer-dispatch.md`
**Risk Level:** 🟢 Low
**Verdict:** Solid. Aligned with note 60 and ROADMAP Phase 50 (C1). Only non-blocking refinements below.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** WARN — no boundary issues. The reducer registry, `selectColumns`, and reshape functions all live inside the `sessions` module (`biometric-aggregation.util.ts`), consumed by `sessions.service.ts` in the same module. No cross-module internals are imported. No schema change → no migration, consistent with Phase 48's "no new table/write/cache/migration" property.
- **Rules (`.ai-factory/RULES.md`):** PASS — no non-null assertions introduced; logging stays minimal (none added), matching the "keep logs lean" rule and the plan's `Logging: minimal` setting. gRPC `@Payload()` rule is not relevant (REST path).
- **Roadmap (`.ai-factory/ROADMAP.md`):** PASS (linkage explicit) — plan maps 1:1 to the `[ ] (C1)` item under Phase 50. One WARN below on the DoD's CPU-measurement guard.

## Correctness Verification (against actual code)

Cross-checked every claim in the plan against `biometric-aggregation.util.ts`, `sessions.service.ts`, `sessions.controller.ts`, `dto/time-range-query.dto.ts`, and `biometric-aggregation.util.spec.ts`:

- **`NUMERIC_LEAF` byte-identity holds.** Current SQL select is `min((kv.value #>> '{}')::numeric) AS min, max((kv.value #>> '{}')::numeric) AS max` (service lines 299–300). With `NUMERIC_LEAF = "(kv.value #>> '{}')::numeric"`, the template `min(${NUMERIC_LEAF}) AS min, max(${NUMERIC_LEAF}) AS max` reproduces the same aggregate semantics → back-compat rowset is byte-equal. ✓
- **Midpoint offset is consistent.** `bucketMidpointOffsetMs = bucketSec * 500` equals the existing `bucketMaxOffsetMs` (util line 58). Having `bucketMaxOffsetMs` delegate keeps one source of truth and does not change the `minmax` output. The `avg` sample lands at the same offset as the `max` sample, which is harmless across distinct requests. ✓
- **`reshapeAvgRows` determinism is sound.** One record per `(sampleType, bucket)`; `timestamp = bucketStart + midpoint` is unique per bucket, `sampleType` disambiguates same-bucket collisions, so `(timestamp, sampleType)` is a genuine total order — mirroring `reshapeAggregateRows`. Sorted `data` keys preserve the all-numeric-keys contract the web `toSeries(field)` pipeline depends on. ✓
- **`AvgRow.avg: string` matches pg.** Postgres `avg(numeric)` returns numeric, surfaced as a string by the driver; `Number(row.avg)` is correct, matching the existing `Number(row.min)` pattern. ✓
- **SQL skeleton stays intact.** `FROM`, all `WHERE` guards (session id, `jsonb_typeof`, garbage-bound, coarse `flushedAt`, half-open `[from,to)`), `GROUP BY "sampleType", bucket, field`, `ORDER BY`, and the absolute `floor(ts/bucketMs)` anchoring (Phase 49) are untouched → windowed `avg` tiles. The `avg` `ORDER BY` references only existing columns. ✓
- **Existing unit tests survive.** `biometric-aggregation.util.spec.ts` imports `reshapeAggregateRows` and asserts `maxEntry.timestamp === BSEC*500` (spec line 199). Plan keeps `reshapeAggregateRows`/`bucketMaxOffsetMs` exports and values unchanged → no spec breakage despite `Testing: no`. ✓
- **No other callers break.** `aggregateBiometrics` is private (only `listBiometrics` calls it); `listBiometrics` has a single caller — the controller — which the plan updates. Return-type change is internally contained. ✓
- **DTO/controller wiring is correct.** `@IsIn(['minmax','avg'])` + global validation pipe yields automatic 400 on unknown values; no DTO default (absence resolved in service) matches the spec's back-compat requirement. ✓

## Non-Blocking Findings

1. **Dead code left behind (maintainability).** After Task 3 routes all modes through `strategy.reshape(...)`, the private `reshapeAggregatedBiometrics` wrapper (service lines 329–340) and its ~28-line tiling/flushedAt doc comment (lines 312–328) become orphaned. Recommend the plan explicitly state: remove `reshapeAggregatedBiometrics`, and relocate any still-relevant tiling/flushedAt prose to the new dispatch site or keep it on `aggregateBiometrics` (the util header already carries the tiling contract). Otherwise the implementer may leave an unused method.

2. **Registry reshape typing needs reconciliation (TS friction).** Task 2 changes `aggregateBiometrics`'s return type to `Record<string, unknown>[]`, but `reshapeAggregateRows` expects `AggregateRow[]` and `reshapeAvgRows` expects `AvgRow[]`. A single registry literal cannot give `reshape` one strict param type for both strategies, and `Record<string, unknown>[]` is not assignable to `AggregateRow[]`. The implementer must type the registry's `reshape` param loosely (e.g. `(rows: any[], bucketSec: number) => Record<string, unknown>[]`, or a `AggregateRow[] | AvgRow[]` union with a cast at the call site). Worth pinning in the plan so the implementer doesn't fight the compiler or reach for `// @ts-ignore`.

3. **CPU-measurement DoD omitted (roadmap linkage).** Note 60 §Guards and the ROADMAP C1 item both call for "measure CPU on the 389k-motion session (`dc8b6de1-…`)" to confirm `avg` is ≤ min/max cost. With `Testing: no` this is understandable, but the plan should at least note this as a post-implementation manual verification step rather than silently dropping it.

4. **`agg` leaks onto the instructions endpoint (minor semantic).** `TimeRangeQueryDto` is shared by `listBiometrics` and `listInstructions` (controller lines 37–64). Adding `agg` means `GET /runs/:id/instructions?agg=foo` now 400s on an unknown value while a valid `agg` is silently ignored. This is consistent with the existing precedent (`bucketSec` is already shared and ignored by instructions), so it is acceptable — but if a cleaner contract is desired, a biometrics-specific DTO would isolate the param. Not required for this milestone.

## Positive Notes

- The strategy-registry framing (selectColumns + reshape keyed by `AggMode`) is the right extension point; C2 (`lttb`) and future `median` become a single registry entry plus reducer, exactly as the roadmap intends.
- Explicit insistence on byte-identical `minmax` SQL and "defensive default to `minmax`" correctly protects the back-compat guarantee that mind_web's tiling depends on.
- Correctly preserves the no-413/no-ROW_CAP property on the aggregation path and leaves the raw-path 413 guard intact.
- Dependency ordering (Task 1 → 2 → 3 → 4) is accurate and matches the actual call graph.

PLAN_REVIEW_PASS
