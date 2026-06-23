# Plan Review 2: (C2) `agg=lttb` mode (shape-preserving, non-lagging)

**Plan:** `.ai-factory/plans/78-c2-agg-lttb-mode-shape-preserving-non-lagging.md`
**Reviewed against:** `src/sessions/biometric-aggregation.util.ts`, `src/sessions/sessions.service.ts`,
`src/sessions/dto/time-range-query.dto.ts`, `src/sessions/biometric-aggregation.util.spec.ts`,
spec note `61-biometric-agg-lttb-mode.md`, `ROADMAP.md` C2 (line 295), and plan-review-1.

**Risk Level:** 🟢 Low — this revision closes every finding from review 1. The remaining items are
small specification gaps (a concrete fallback cap value, an environment-dependency note), none of
which block implementation.

---

## Resolution of Review-1 Findings

- **Finding 1 (unbounded `'points'` path shipping live):** RESOLVED. The plan now adds a dedicated
  `LTTB_POINTS_ROW_CAP` enforced via `LIMIT cap+1` → `PayloadTooLargeException`, and explicitly lands
  the guard **in Commit 1, before the endpoint is reachable** (Resource-guard section lines 60–70,
  Task 4 lines 128–131). The misleading "no ROW_CAP needed" service comment is scheduled for update.
- **Finding 2 (Task 6 fallback is an algorithm change, not a transfer optimization):** RESOLVED.
  Task 6 now states the value-min/value-max fallback is "a different, lower-fidelity algorithm" that
  "would change selected values and invalidate the Task 5 tiling and spike tests," and instructs not
  to adopt it pre-emptively (lines 157–162).
- **Finding 3 (LTTB-name divergence undocumented):** RESOLVED. The "Naming note" (lines 29–34) and
  Task 7b (lines 173–177) record the bucket-local divergence in note 61 / ROADMAP and resolve note
  61's Open Question.
- **Findings 4–6 (spike-at-endpoint caveat, midpoint stamping, wasted ORDER BY):** RESOLVED. The
  accepted endpoint limitation is documented (lines 46–49) and slated for an impl doc comment (Task
  2); tests assert on the selected **value** not its timestamp (lines 54–55, 146); the `'points'`
  path drops `ORDER BY` (lines 125–127).

---

## Context Gates

- **ARCHITECTURE** (WARN-clear): All edits remain inside the `sessions` module (util + service + dto +
  spec). No cross-module imports, no new entity injection, no new migration. Consistent with the
  modular-monolith boundaries in CLAUDE.md.
- **RULES** (WARN-clear): Task 2 explicitly calls out "no non-null assertions; explicit guards on
  optional values." Logging is "minimal." Consistent with project rules. No `aif-review` skill-context
  file present (`.ai-factory/skill-context/aif-review/SKILL.md` absent) — no project overrides to apply.
- **ROADMAP** (WARN-clear): C2 (line 295) is correctly targeted; C1 is `[x]` complete, so the declared
  dependency is satisfied — the live code shows `AggMode = 'minmax' | 'avg'` and a populated
  `AGG_REGISTRY`, confirming the C1 substrate this plan builds on exists.

---

## Verified Assumptions (correct against current code)

- `AggMode = 'minmax' | 'avg'` (util line 22) and `@IsIn(['minmax', 'avg'])` (dto line 20) — Task 1's
  two edit sites are accurate.
- The SELECT prefix is genuinely shared: the grouped query already builds
  `SELECT elem->>'sampleType' …, floor(…) AS bucket, kv.key AS field, ${strategy.selectColumns}`
  (service lines 297–309). The `'points'` branch differs only in `selectColumns` content and the
  removal of `GROUP BY`/`ORDER BY` — so "branch only the SELECT/GROUP/ORDER tail" (Task 4) is exact.
- Dropping `ORDER BY` on `'points'` is safe: `reshapeLttbRows` re-sorts each group by `(ts, value)`
  and applies a final `(timestamp, sampleType)` total sort — the same determinism mechanism
  `reshapeAvgRows` already relies on (util lines 222–229). Output stays byte-stable regardless of SQL
  row order.
- Tiling argument is sound: window edges are bucket-aligned, so each bucket is fully contained in one
  window; a bucket-local chord (bucket's own first/last point) sees the identical point set in
  full-session and windowed runs → byte-equal. The area-0 mean fallback (`|value − bucketMean|`) is
  also bucket-local, so it does not break tiling.
- `collectRawPoints` mirroring `aggregateRawSamples` (same garbage `> garbageBound` + half-open
  `[from,to)` filters, numeric-leaf iteration via `typeof === 'number'`, string-encoded output) is the
  correct test-only reference, matching the existing DB-less unit-test convention (the SQL↔helper
  equivalence is covered by e2e, per util lines 46–48).
- `LIMIT cap+1` + `rows.length > cap` is a cleaner 413 contract than the raw path's `=== ROW_CAP`,
  and `PayloadTooLargeException` is already imported in `sessions.service.ts` (line 7).
- No migration, no new index — the `'points'` query is the existing grouped plan minus the
  GROUP BY; correctly omitted.

---

## Findings

### Medium

**M1. The cap's concrete value is left unpinned, and the step that sets it may not be runnable.**
`LTTB_POINTS_ROW_CAP` is the plan's primary (and only) safety mechanism for the `'points'` path, yet
Task 4 ships it as "a conservative placeholder" and defers the real number to Task 6's measurement of
the 389k-motion session "with headroom" (lines 130–131, 151–156). Two problems:

- Task 6 requires the 389k-motion session present in a reachable Postgres. If the implementing agent's
  environment lacks that data (likely for a code-only implement pass), Task 6 cannot execute and
  Commit 1's "finalize the cap" sub-task silently can't complete — leaving the guard at an
  unvalidated placeholder.
- "Conservative" is directionally ambiguous for a guard: too low 413s the *intended* 389k workload;
  too high defeats the OOM protection. The Context already estimates the points rowset at **~1–2M rows**
  for that session (lines 62–64). Pin a concrete default derived from that estimate (e.g. ~3M, above
  the 1–2M legitimate workload, below pathological territory) as the committed value, and treat Task 6
  as *confirm/adjust* rather than *derive-from-scratch*. That way Commit 1 ships a real, non-placeholder
  guard even if the measurement environment is unavailable.

Not architecturally blocking — but since the whole Commit-1 safety story rests on this one constant,
it should land as a definite number, not a TODO.

### Low / Nits

**L1. Two-point bucket always resolves to the first point — assert the exact value.** For a
2-point bucket, both points lie on the chord (area 0), so the fallback fires; but
`|vA − mean| = |vC − mean| = |vA − vC|/2`, i.e. the two candidates are always tied on
`|value − bucketMean|`, so the tie-break (earliest `ts`, then smallest `value`) deterministically
selects the **first** point. Task 5's two-point edge case (line 147) should assert that exact
selected value (the first point's), not merely "fallback fires" — otherwise the test under-specifies
the behavior it's meant to lock.

**L2. Pin the strict-greater scan so the tie-break is actually realized.** The pinned rule's
"earliest `ts`, then smallest `value`" tie-break only holds if the argmax scan over the
`(ts, value)`-sorted points keeps the current best on strict `>` (not `>=`). Worth one line in Task 2
so the implementer doesn't accidentally use `>=` and select the *last* max-area point instead of the
first.

**L3. `bucketMean` must be computed from the same parsed numeric values used for area.** The fallback
mean is per-(sampleType, bucket, field) over the bucket's own points. This is implied by "bucket-local"
but not stated; a one-line note in Task 2 keeps it unambiguous (and keeps it tiling-safe).

---

## Positive Notes

- This is a clean, complete response to review 1: every Critical/High/Medium/Low item was folded into
  the plan text with explicit rationale rather than hand-waved. The Resource-guard section in
  particular converts the previous unbounded-path risk into a pinned, Commit-1 guard.
- The "Key Design Decision" and "Naming note" sections remain exemplary — they derive the bucket-local
  variant from the byte-equal-tiling constraint and record the divergence from classic LTTB as a
  decision, not drift, with Task 7b closing the loop in note 61 / ROADMAP.
- Strong reuse: `bucketStartMs`, `bucketMidpointOffsetMs`, the `reshapeAvgRows` packing pattern, the
  `aggregateRawSamples`-style test reference, and the shared WHERE/`floor(...)` plumbing are all
  leveraged; the `kind: 'grouped' | 'points'` registry generalization keeps the service SQL branch
  minimal and type-safe.
- Test plan targets the right hard gate (tiling byte-equality incl. the multi-`sampleType`
  shared-`bucketStart` ordering case) plus determinism, spike-vs-avg, and edge cases.
- Commit plan is coherent: the DTO value, util, registry, dispatch, guard, and tests all land together
  in Commit 1 so the endpoint is never reachable without a guarded, tested path; the doc/cross-repo
  follow-ups are correctly scoped out.

---

## Verdict

The plan is solid and maps accurately onto the current codebase. The only substantive residual is
**M1**: commit a concrete `LTTB_POINTS_ROW_CAP` default (derived from the documented ~1–2M estimate)
rather than a placeholder dependent on a measurement that may not be runnable in the implement
environment. The Low items are test-precision and implementation-clarity nits. None require
re-architecting or change the approach.

PLAN_REVIEW_PASS
