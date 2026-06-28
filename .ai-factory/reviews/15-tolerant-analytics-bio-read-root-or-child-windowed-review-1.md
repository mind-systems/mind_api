# Code Review: Tolerant analytics bio read (root-or-child, windowed)

**Plan:** `.ai-factory/plans/15-tolerant-analytics-bio-read-root-or-child-windowed.md`
**Reviewed diff:** `git diff HEAD` — only `src/sessions/sessions.service.ts` changed (plus plan/review artefacts).

## Scope reviewed
- Full read of `src/sessions/sessions.service.ts` (`listBiometrics` + `aggregateBiometrics`, surrounding helpers, `listInstructions`).
- `ModuleSession` entity (`src/realtime/entities/module-session.entity.ts`) — field nullability.
- Call sites of `listBiometrics` / `aggregateBiometrics` (controller + the single private call site).
- Project typecheck (`tsc --noEmit`).

## Correctness verification

**Id-set resolution (Task 1).** `bioSessionIds` is built once from the resolved, ownership-checked `session`. Always 1 or 2 non-null UUIDs (`session.rootSessionId != null` guards the second element). Entity confirms `rootSessionId: string | null`, so the null guard is correct. ✓

**Raw path (Task 2).** `where.moduleSessionId` switched to `In(bioSessionIds)`; `In` added to the `typeorm` import. The per-sample window now defaults to the session's own interval — `fromMs = fromDate?.getTime() ?? session.startedAt.getTime()`, `toMs = toDate?.getTime() ?? session.endedAt?.getTime()`. The coarse `flushedAt` branches (lines 208–219) remain driven by the original `fromDate`/`toDate`, so an omitted bound correctly does **not** fire the coarse filter — the per-sample default does the exact trim. `ROW_CAP` take + 413 guard, `FLAT_CAP` guard, `order`, and half-open `<`/`>=` comparisons are unchanged. ✓

**SQL path (Task 3).** `sessionParam = p(session.id)` replaced with `sessionIdsParam = p(bioSessionIds)`, and the first condition is now `b."moduleSessionId" = ANY(${sessionIdsParam})`. The JS `string[]` is bound as a single param to `bioSampleRepo.query(sql, params)`; node-postgres serializes it to a Postgres array, so `= ANY($n)` matches against the `uuid` column. The same per-sample window default is applied; coarse `flushedAt`, `garbageBoundParam`, `jsonb_typeof` checks, epoch-0 bucket expression, and `LTTB_POINTS_ROW_CAP` guard are untouched. ✓

**Signature threading.** `aggregateBiometrics` is `private` with exactly one call site (line 182), which was updated to pass `bioSessionIds` in the correct position (`session, bioSessionIds, bucketSec, mode, from, to`). The public `listBiometrics` signature is unchanged, so the controller call is unaffected. ✓

**Instructions untouched (Task 4).** `listInstructions` still filters `session_stream_samples` by `moduleSessionId: sessionId` only — no id-set or window default leaked in. ✓

**Nullish-coalescing correctness.** `?? ` (not `||`) is used, so a legitimate `fromMs`/`toMs` of `0` would not be clobbered (moot for real timestamps, but correct). For an in-flight session, `toDate` undefined + `endedAt` undefined yields `toMs = undefined`, leaving the upper bound open — live samples still returned, as specified. ✓

**Typecheck.** The changed file compiles with zero errors. (See note 1 for unrelated pre-existing errors.)

**Security.** Ownership is still enforced via `assertSessionOwnership` before any id-set use. All ids are uuid-bound query parameters (`In(...)` / `ANY($n)`) — no string interpolation into SQL, no injection surface introduced. ✓

## Findings

### Non-blocking

1. **Pre-existing, unrelated typecheck errors (not introduced here).** `tsc --noEmit` reports 3 errors, all in `src/realtime/services/biometric-stream-engine.service.spec.ts` (TS2352 `BioSampleInternal` cast). That file is not part of this diff and the errors are independent of this change; the production build (`nest build`, which excludes `*.spec.ts`) is unaffected. Flagged only so it is not mistaken for a regression from this change. No action required for this task.

2. **Legacy reads are behaviorally equivalent, not literally byte-identical.** The per-sample window default `[startedAt, endedAt)` is applied unconditionally, including the single-id legacy case. Two boundary deltas vs. the old no-`from`/`to` read:
   - A sample with `timestamp === endedAt` is now excluded (half-open upper bound).
   - The raw path gains an effective `ts >= startedAt` lower bound it lacked before, so epoch-0 / pre-start garbage samples that the raw path previously emitted are now dropped.
   Both are improvements and align with the spec's intent, but the manual-verification step (1) should deliberately exercise a legacy session containing boundary/garbage samples to confirm the delta is acceptable rather than assuming zero delta. This matches the spec and is the intended design — not a defect.

3. **ROW_CAP false-413 risk grows for root-bound reads (future phase).** When a child reads with no `from`/`to`, the coarse `flushedAt` filter does not fire, so all of the root's batches (across siblings) are fetched before the per-sample window trims to the child's slice. `take: ROW_CAP = 60_000` is unchanged, so a busy root could approach the cap sooner than a child-only read once ingest flips to the root (Phase 58 task 2). Not exploitable now (legacy bio still lives on the child); noted as a scaling watch-item for the ingest-flip task, consistent with the plan's decision to keep the guards unchanged.

## Verdict
The change is a faithful, correct implementation of the plan and spec. It compiles, preserves all 413/ROW_CAP/FLAT_CAP guards, keeps the load-bearing separation between the coarse `flushedAt` filter (original request bounds) and the per-sample window (defaulted bounds), keeps instructions per-child, and introduces no injection surface. The observations above are non-blocking — pre-existing unrelated test-file type errors and design caveats already anticipated by the spec.

REVIEW_PASS
