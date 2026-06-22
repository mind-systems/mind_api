# Plan Review: Deterministic absolute bucket alignment for windowed aggregation

**Plan:** `.ai-factory/plans/76-deterministic-absolute-bucket-alignment-for-windowed-aggregation.md`
**Files reviewed:** plan, `src/sessions/sessions.service.ts`, `src/sessions/sessions.service.spec.ts`, spec note `59-windowed-aggregation-bucket-alignment.md`, ROADMAP Phase 49, RULES.md, ARCHITECTURE.md
**Risk Level:** 🟡 Medium

## Verdict
The plan's **findings are accurate**: the SQL bucketing is already epoch-anchored (`floor((elem->>'timestamp')::numeric / bucketMs)`, line 289), both paths already use half-open `[from, to)` filters (raw: lines 202–203; agg: lines 280, 283), and `reshapeAggregatedBiometrics` derives `bucketStart = bucket * bucketSec * 1000` with max at `+ bucketSec*500` (lines 347–350). The conclusion that this is a verify + document + test task — not a re-anchoring rewrite — is correct, and the epoch-0 origin choice is consistent with both the spec note and production. No migration is needed (no schema change) — correctly identified.

However, there is one **structural gap that undermines the milestone's core deliverable**, plus two narrower issues. The milestone requires proving N windowed requests are *byte-equal* to one full-session request **in production**. The plan instead proves a *pure helper* is byte-equal and only loosely couples it to production — so the test can pass while production still violates the contract.

## Context Gates
- **Architecture (ARCHITECTURE.md):** PASS. New `biometric-aggregation.util.ts` is a dependency-free helper inside the `sessions` module — respects module boundaries; no cross-module internal imports. No WARN.
- **Rules (RULES.md):** PASS. No non-null assertions, no sensitive logging, no gRPC `@Payload()` concerns introduced. Plan says "Logging: minimal" — consistent with "keep logs lean". No WARN.
- **Roadmap (ROADMAP.md):** PASS. Plan links directly to Phase 49 / spec note 59, matches the milestone wording (absolute origin, half-open, byte-equal tiling test, no contract change, independent of `agg=avg|lttb`). Good linkage.

## Critical Issues

### 1. The byte-equal test validates a proxy; production `reshapeAggregatedBiometrics` is not actually deterministic
This is the central problem. The plan's regression test (Task 4) exercises only the pure helper `aggregateSamplesToBioDtos`. But the production output ordering has a latent non-determinism the helper test cannot catch:

`reshapeAggregatedBiometrics` ends with:
```ts
result.sort((a, b) => (a['timestamp'] as number) - (b['timestamp'] as number));
```
This sorts **by timestamp only**. When multiple `sampleType`s exist (per ROADMAP, `motion` + others coexist), every sampleType emits a *min* entry at the **same** `bucketStart` and a *max* entry at the same `bucketStart + bucketSec*500`. These collide on timestamp. JS `Array.prototype.sort` is stable, so ties resolve to **insertion order** = `grouped.values()` = first-seen order in `rows` = the SQL row return order. **The SQL has no `ORDER BY`** (line 297 is `GROUP BY` only), so Postgres does not guarantee a stable row order across calls.

Consequence: two different requests covering the same bucket (full-session vs the window that owns it), or even two identical full-session calls, can return same-timestamp entries in different orders → **not byte-equal in production**, even though the helper test is green. The plan's claim (Task 1) to "lock the determinism contract" is only locked for the helper, not for the code path the milestone is about.

**Fix the plan to make production deterministic, not just the helper.** Pick one:
- Add a stable secondary sort key to `reshapeAggregatedBiometrics` — e.g. sort by `(timestamp, sampleType)` and ensure min-before-max is intrinsic (it is, via the `+bucketSec*500` offset). And/or add `ORDER BY "sampleType", bucket, field` to the SQL.
- Or route `reshapeAggregatedBiometrics` through the same helper that the test locks down (stronger: the thing under test *is* the production reshape), so determinism is shared rather than mirrored.

Either way, Task 4's byte-equal assertion should cover the **multiple-sampleType, same-`bucketStart`** case explicitly — that's the case that actually breaks today and the plan's enumerated test cases (clean tiling, single-sample-per-bucket, boundary sample) all miss it.

## Other Issues

### 2. `flushedAt` coarse filter can break tiling at window seams — unmodeled by the pure helper (Medium)
Rows are fetched by `flushedAt`, not by sample `timestamp`. For an interior window `[t1, t2)` the aggregation adds `b."flushedAt" >= t1` (lines 265–271). A sample whose per-sample `timestamp` falls in `[t1, t2)` but whose batch was flushed before `t1` (device clock ahead of server — plausible, since timestamps are client-provided and untrusted, hence the `GARBAGE_TS_SLACK_MS` / epoch-0 garbage handling) is **included in the full-session query but excluded from the interior window** → a real seam/lost-bucket in production. The pure helper has no `flushedAt` concept, so Task 4 can never surface this.

The plan's Findings section does not mention `flushedAt`'s effect on tiling at all. At minimum, Task 3's documentation should state the tiling guarantee assumes `flushedAt >= timestamp` (batches flushed at or after the samples they contain) and that clock-skewed samples are out of scope. Better: note that the only faithful test of the full path is an integration/e2e test against Postgres (see #3).

### 3. Task 2's "cannot drift" guarantee is overstated (Minor)
Sharing `bucketStartMs(...)` covers only the **reshape arithmetic**. The actual bucket *index* math lives in the SQL string (`floor(ts / bucketMs)`) and is **not** shared with the helper's `bucketIndexForMs`. The test never executes the SQL, so a divergence between the SQL formula and the helper would go undetected — exactly the drift Task 2 claims to prevent. This is inherent to the DB-less approach and is acceptable, but the plan should state the limitation honestly rather than claim the two "cannot drift". Task 3's lockstep comment is the only real guard; consider whether a single Postgres-backed integration test (the suite is DB-less today, but `test:e2e` exists) is warranted to actually pin SQL↔helper equivalence.

### 4. Helper fidelity gaps to mirror (Minor)
For the helper to be a faithful "single source of truth", `aggregateSamplesToBioDtos` should also mirror the SQL's leaf selection: only numeric `data` leaves (`jsonb_typeof(kv.value) = 'number'`) and the garbage-timestamp drop (`timestamp > startedAt - GARBAGE_TS_SLACK_MS`). These are constant across windows so they don't affect the *tiling* assertion, but if the helper is later trusted as the reference aggregator, omitting them is a foot-gun. Worth one line in Task 1 noting these are intentionally in/out of scope.

## Positive Notes
- Findings are precise and line-accurate; the "already absolute" conclusion is correct and avoids an unnecessary rewrite.
- Half-open `[from, to)` semantics correctly identified on both paths.
- Epoch-0 origin choice correctly justified and matched to production (no `session.startedAt` switch — avoids needless churn).
- Stable sorted field-key order (Task 1) is the right instinct for byte-equality — it just needs to be extended to the sample-entry tie-break (#1).
- Test cases for boundary samples (ts exactly on a window edge) and the `from`-independence assertion (`[B,3B)` vs `[0,4B)`) are well-chosen.
- Scope discipline is good: no contract change, stays clear of the `agg=avg|lttb` milestone, single commit.

## Recommendation
Address #1 (make production reshape deterministic and test that path / the multi-sampleType tie case) before implementation — without it the plan can ship a green test that does not prove the milestone's contract. Fold #2 into the Task 3 documentation (and consider an integration test for #3). #4 is a nice-to-have.
