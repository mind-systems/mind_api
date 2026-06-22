# Plan Review #2: Deterministic absolute bucket alignment for windowed aggregation

**Plan:** `.ai-factory/plans/76-deterministic-absolute-bucket-alignment-for-windowed-aggregation.md`
**Files reviewed:** plan, `src/sessions/sessions.service.ts`, spec note `59-windowed-aggregation-bucket-alignment.md`, plan-review #1, RULES.md
**Risk Level:** 🟢 Low

## Verdict
This revision resolves every issue raised in plan-review #1. The findings remain line-accurate against the current code, and the plan now restructures the work so the milestone's actual deliverable — *byte-equal production output* — is what gets pinned, rather than a parallel mirror. The architecture is sound, no migration is needed, and scope discipline is intact.

## Context Gates
- **Architecture:** PASS. The new `biometric-aggregation.util.ts` is a dependency-free helper inside the `sessions` module — no cross-module internal imports, respects modular-monolith boundaries.
- **Rules (RULES.md):** PASS. No non-null assertions introduced (the existing `!` usages are in untouched `listRuns` code, out of scope). "Logging: minimal" is consistent with "keep logs lean". No gRPC `@Payload()`/`@GrpcCurrentUser()` surface touched.
- **Roadmap:** PASS. Directly anchored to spec note 59 / Phase 49; matches the milestone wording (absolute epoch origin, half-open `[from, to)`, byte-equal tiling test, no contract change, independent of `agg=avg|lttb`). No skill-context file present (`.ai-factory/skill-context/aif-review/SKILL.md` absent) — nothing to override.

## How review #1's issues were addressed
1. **#1 (production reshape not deterministic — the central blocker):** Resolved correctly and in the stronger of the two suggested ways. Task 2 routes production `reshapeAggregatedBiometrics` through the shared `reshapeAggregateRows`, so the function under test *is* the production path. The total `(timestamp, sampleType)` order plus sorted `data` keys removes both the timestamp-tie and key-order non-determinism. Task 4 adds the multi-sampleType same-`bucketStart` case that today's code breaks on. ✅
2. **#2 (flushedAt coarse filter can break tiling at seams):** Folded into Task 3 as an explicit documented caveat (assumes `flushedAt >= timestamp`; clock-skew case out of scope). ✅
3. **#3 (SQL↔helper drift unguarded by DB-less test):** Honestly stated in Task 3 (lockstep comment) and given a real guard via the optional Task 5 Postgres e2e, with a clean skip path if no DB. ✅
4. **#4 (helper fidelity — numeric-leaf + garbage-timestamp rules):** Task 1 now mirrors `jsonb_typeof(kv.value) = 'number'` and the `> startedAt - GARBAGE_TS_SLACK_MS` drop in `aggregateRawSamples`. ✅

## Verification of technical claims
- Code references are accurate: epoch-anchored bucket index (line 289), half-open filters (lines 280/283), reshape `bucketStart`/`+bucketSec*500` (lines 347–350), timestamp-only sort (lines 356–358), `GROUP BY` with no `ORDER BY` (line 297).
- The claim that `(timestamp, sampleType)` is a **total** order checks out: within a bucket, min and max timestamps differ by `bucketSec*500` (> 0 for any positive `bucketSec`); the max of bucket *b* (`b·bucketSec·1000 + bucketSec·500`) never equals the min of bucket *b+1* (`(b+1)·bucketSec·1000`), gap is `bucketSec·500`; distinct sampleTypes at an identical timestamp are separated by the second key. So insertion/row order genuinely becomes irrelevant — the determinism argument is correct, not just plausible.
- Byte-equality via `JSON.stringify` is safe here because both full and tiled paths construct objects through the same `reshapeAggregateRows`, giving identical top-level key insertion order (`timestamp`, `sampleType`, `data`) and identical sorted `data` keys.

## Minor (non-blocking) notes
- The test proves the **tiling property of the `aggregateRawSamples → reshapeAggregateRows` path**; the real production SQL bucket-index math is only guarded by the Task 3 lockstep comment (and Task 5 if a DB is available). The plan states this limitation honestly — no change required, just flagging it so implementers don't oversell the unit test's coverage.
- Optional polish: when implementing the defense-in-depth `ORDER BY` in Task 2, keep it as a comment-justified redundancy as the plan says — fine to include or omit since the reshape's total order is authoritative.

## Positive Notes
- Restructuring around a single shared pure function (rather than a mirrored test helper) is the right call and directly closes the review #1 gap.
- The enumerated test cases (multi-sampleType collision, clean tiling, single-sample bucket, exact-edge boundary, `[B,3B)` vs `[0,4B)` from-independence) are well chosen and cover the real failure modes.
- Scope is tight: no contract change, no migration, single commit, no contamination of the `agg=avg|lttb` milestone.

PLAN_REVIEW_PASS
