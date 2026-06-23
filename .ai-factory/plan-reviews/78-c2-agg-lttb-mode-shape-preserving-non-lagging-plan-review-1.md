# Plan Review: (C2) `agg=lttb` mode (shape-preserving, non-lagging)

**Plan:** `.ai-factory/plans/78-c2-agg-lttb-mode-shape-preserving-non-lagging.md`
**Reviewed against:** `src/sessions/biometric-aggregation.util.ts`, `src/sessions/sessions.service.ts`,
`src/sessions/dto/time-range-query.dto.ts`, `src/sessions/biometric-aggregation.util.spec.ts`,
spec note `61-biometric-agg-lttb-mode.md`, ROADMAP Phase 50.

**Risk Level:** 🟡 Medium — the plan is well-reasoned and implementable against the real code, but it
ships one genuinely unbounded code path live in Commit 1, and Task 6's deferred "optimization" is
actually an algorithm change that would invalidate Task 5's tests.

---

## Context Gates

- **ARCHITECTURE** (WARN-clear): All changes stay inside the `sessions` module (util + service + dto +
  spec). No cross-module imports, no new entity injection. Consistent with the modular-monolith
  boundary rules in CLAUDE.md. ✅
- **RULES** (WARN-clear): The plan explicitly calls out the "no non-null assertion / explicit guards on
  optional values" rule (Task 2). Logging is "minimal" — consistent with the lean-logging rule. ✅
- **ROADMAP** (WARN): Milestone C2 (Phase 50, line 295) is correctly targeted, and the plan honors the
  declared dependency on C1. **However**, the implemented algorithm diverges from the ROADMAP/spec
  description of "Largest-Triangle-Three-Buckets" — see Finding 3. This is a justified divergence but
  needs a one-line annotation so future readers know `lttb` here means *bucket-local*, not classic LTTB.

---

## Verified Assumptions (correct)

- `AggMode = 'minmax' | 'avg'` (util line 22) and `@IsIn(['minmax', 'avg'])` (dto line 20) — the two
  edit sites in Task 1 exist exactly as described. ✅
- `AGG_REGISTRY` entry shape (`selectColumns` + `reshape`) and `NUMERIC_LEAF` constant exist as
  described; generalizing with a `kind` field (Task 3) is a clean, type-safe extension. ✅
- `reshapeAvgRows` is the correct pattern to mirror for one-sample-per-bucket packing (midpoint
  timestamp, sorted `data` keys, `(timestamp, sampleType)` total sort). ✅
- `aggregateBiometrics` builds shared WHERE/params/`floor(...)` exactly as the plan states; branching
  only the SELECT/GROUP/ORDER tail (Task 4) is the minimal correct change and preserves the identical
  filtering that the tiling gate depends on. ✅
- The tiling correctness argument is sound: because the tiling contract aligns window edges to
  `bucketSec` multiples, every bucket is fully contained in one window, so a **bucket-local** selection
  (chord = bucket's own first/last point) sees the identical point set in full-session and windowed
  runs → byte-equal. This is the right reason to reject cross-bucket classic LTTB. ✅
- `collectRawPoints` mirroring `aggregateRawSamples` (same garbage + half-open filters, numeric-leaf
  iteration via `typeof === 'number'`, string-encoded output) is the right test-only reference. ✅
- File paths and the validation flow (controller → `TimeRangeQueryDto` → `listBiometrics` → registry)
  are all accurate. ✅

---

## Critical / High

### 1. The `'points'` path bypasses every payload/row guard and ships live in Commit 1
`aggregateBiometrics` today has **no** `ROW_CAP`/`FLAT_CAP`/413 guard, and its own comment
(service lines 228–232) justifies that *specifically because the grouped path returns "only the small
aggregated rowset."* The `'points'` path breaks that premise: it returns **~one row per
`(sample element, numeric field)`** — i.e. it transfers the full raw dataset from Postgres into Node and
builds it into JS Maps/arrays. For the 389k-motion session (motion has multiple numeric leaves), that is
on the order of 1–2M rows with no cap. This reintroduces the exact memory/CPU problem that Phase 48
server-side aggregation was created to eliminate (note 58: "a 30 min+ session ships 100k+ points").

The response to the client stays small (one sample/bucket), so this is a **server-side
resource-exhaustion risk**, not a response-size one — and it is reachable from the public endpoint as
soon as Task 1 accepts `lttb` in the DTO and Task 4 wires the dispatch, i.e. **at Commit 1**. The actual
measurement (Task 6) and any guard land in **Commit 2**.

**Recommendation:** Move a guard into Commit 1 (or gate the path). Options, cheapest first:
- Add a row-count abort in the `'points'` branch (e.g. `LIMIT ROW_CAP+1` or a `COUNT(*)` pre-check →
  `PayloadTooLargeException`), mirroring the raw path's 413 contract, *before* the endpoint is reachable.
- Or sequence the work so Task 6's measurement gates whether Commit 1's `lttb` is exposed at all.

Either way, the comment Task 4 proposes ("note it's heavier; no ROW_CAP per note 58") is not a
substitute for a guard on an uncapped path that the existing code only leaves uncapped because it was
provably small.

---

## Medium

### 2. Task 6's deferred fallback is an algorithm change, not a transfer optimization
Task 6 documents the fallback as: "reduce server→Node transfer by selecting only the per-bucket
value-min and value-max candidate points in SQL and choosing between them by area in Node."

This is **not** equivalent to the pinned selection rule. The max-triangle-area point against the chord
is the point with the largest perpendicular deviation from the first→last line — which is generally
**neither the value-min nor the value-max** of the bucket (consider a bucket whose extreme value sits at
an endpoint, or a chord with steep slope). Restricting candidates to value-min/value-max would therefore
change selected values and **invalidate the tiling and spike-preservation tests written in Task 5**.

**Recommendation:** Either drop this fallback in favor of the guard from Finding 1, or relabel it
explicitly as a *different, lower-fidelity algorithm* whose tests must be re-derived if adopted. As
written it reads as a free optimization, which it is not.

### 3. Divergence from the spec/ROADMAP "LTTB" definition — document it explicitly
ROADMAP C2 and spec note 61 (lines 14–15) describe classic LTTB ("the triangle area formed with the
previously-selected point and the next bucket's centroid"). The plan deliberately implements
**bucket-local LTTB** (chord = the bucket's own first/last point). The plan's justification (cross-bucket
dependency breaks byte-equal tiling) is correct and directly resolves the spec's Open Question
(note 61 line 29). This is the right call.

But the artifact name and the web radio label both say "LTTB", and a future reader comparing this to
note 61 will see a contradiction. **Recommendation:** add one explicit line to the note/ROADMAP entry
(or the impl doc comment) stating that `lttb` here = bucket-local triangle-vs-own-chord, chosen to
preserve the tiling gate — so the divergence is a recorded decision, not a silent drift.

---

## Low / Nits

4. **Spike-at-endpoint blind spot.** With the chord anchored on the bucket's own first/last point, a
   spike that *is* the first or last point has area 0 against the chord and won't be selected; the
   mean-based fallback only triggers when **all** areas are 0. So a near-monotonic bucket whose extreme
   sits on an edge maps to an interior, less-extreme point. This is inherent to the chosen variant and
   acceptable for a comparison testbed, but worth a one-line caveat in the impl so it isn't mistaken for
   a bug during QA ("why didn't lttb keep this peak?").

5. **Midpoint stamping discards the selected point's real x.** Placing the representative at
   `bucketStart + bucketMidpointOffsetMs` (consistent with `avg`, per note 61 line 30) is the right
   choice for tiling/contract, but means the spike's true timestamp is replaced by the bucket midpoint.
   Already a settled decision — just confirm Task 5 asserts on the *value*, not the timestamp, of the
   spike.

6. **`ORDER BY` on the `'points'` path is wasted Postgres work.** `reshapeLttbRows` re-sorts every
   group by `(ts, value)` in JS, so the SQL `ORDER BY "sampleType", field, bucket, ts, value` only adds
   a sort over the full (large) raw rowset. Either drop it on the points path (saves a sort on 1M+ rows)
   or keep it solely for EXPLAIN readability — but note in the plan it's not needed for correctness.

7. **Intra-commit ordering.** Task 1 ("No behavior change yet") makes the DTO accept `lttb` before the
   dispatch exists, but since Tasks 1–4 land together in Commit 1 there's no broken shipped state.
   Fine — just don't split Task 1 into its own commit.

---

## Positive Notes

- The "Key Design Decision" section is exemplary: it identifies the precise reason classic LTTB would
  break the byte-equal tiling gate and derives the bucket-local variant from that constraint, with a
  fully pinned, deterministic selection rule (sort key, area formula, area-0 fallback, tie-breaks).
- Strong reuse: `bucketStartMs`, `bucketMidpointOffsetMs`, and the `reshapeAvgRows` packing pattern are
  all leveraged rather than reinvented; the registry `kind` generalization keeps the service plumbing
  untouched.
- Test plan targets the right hard gate (tiling byte-equality incl. the multi-`sampleType` shared
  bucketStart ordering case) plus determinism, spike-vs-avg, and edge cases — and adds the matching
  `collectRawPoints` reference exactly as `aggregateRawSamples` does for the grouped path.
- Cross-repo Task 7 (mind_web) is correctly scoped out of the `mind_api` commits as a handoff item.
- RULES compliance (no non-null assertions, explicit optional guards) is called out at the point of use.

---

## Verdict

The plan is fundamentally sound and maps accurately onto the codebase. Address **Finding 1** (guard the
unbounded points path before it is reachable) and reconcile **Finding 2** (the Task 6 fallback is an
algorithm change) before implementing; annotate **Finding 3**. None of these require re-architecting —
they are scope/sequencing and one missing guard.
