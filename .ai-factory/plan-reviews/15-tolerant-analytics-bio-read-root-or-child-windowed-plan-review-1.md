# Plan Review: Tolerant analytics bio read (root-or-child, windowed)

**Plan:** `.ai-factory/plans/15-tolerant-analytics-bio-read-root-or-child-windowed.md`
**Target:** `mind_api/src/sessions/sessions.service.ts`
**Risk Level:** 🟢 Low — solid, faithful to spec, dependency satisfied

## Scope verified

Read the plan, its spec note (`notes/09-analytics-tolerant-bio-read.md`), the target service, and the
`ModuleSession` / `BioSessionSample` entities. All file paths, API usage, and line references were checked
against the current code.

### Codebase assumptions — all confirmed
- **Import block** (lines 10–16) is exactly `And, FindOptionsWhere, LessThan, MoreThanOrEqual, Repository` — `In` is genuinely missing and must be added. ✓
- **`assertSessionOwnership`** returns the full `ModuleSession` and is called at line 168; the resolved `session` is already passed into `aggregateBiometrics` (lines 173–179). ✓
- **Entity fields** exist with the assumed types: `id: string`, `rootSessionId: string | null` (nullable uuid), `startedAt: Date` (non-null), `endedAt?: Date` (nullable). The `session.rootSessionId != null` and `session.endedAt?.getTime()` patterns are correct against these types. ✓ The dependency on the root-session schema task (Phase 02) is already merged — the entity has the column.
- **Raw path** `where` at lines 188–190, per-sample checks at lines 231–232, coarse `flushedAt` branches at 194–205 — all match. ✓
- **SQL path** `const sessionParam = p(session.id);` at line 279, first `conditions[]` entry at 288, per-sample filters at 310–315, coarse conditions at 296–307, `bioSampleRepo.query(sql, params)` at 350–353 — all match. ✓
- **`listInstructions`** at line 364 filters by `moduleSessionId: sessionId` only — Task 4's "no change" guard is correct. ✓

The plan's line numbers were re-anchored to the current file (they differ from the spec note's older anchors and are accurate to the live code).

## Context Gates
- **Architecture:** Change stays inside `SessionsModule`, reads bio via the already-injected `bioSampleRepo`, no cross-module internal imports. Aligned with the modular-monolith boundary. ✓ No new schema/migration introduced (correct — the plan explicitly defers schema/ingest to later phases). ✓
- **Rules (`RULES.md`):** No non-null assertions introduced (`session.endedAt?.getTime()` uses optional chaining, not `!`). No new logging (plan says minimal). No gRPC decorator concerns. ✓ **PASS**
- **Roadmap:** Directly implements Phase 58 → "Tolerant analytics bio read (root-or-child, windowed)". Strong linkage, spec note referenced. ✓

## Critical Issues
None. The plan is internally consistent, technically correct, and safe to implement.

## Non-blocking observations (WARN)

1. **"Byte-identical" legacy claim has edge-case caveats.** The plan (and spec) state legacy `rootSessionId`-null reads stay byte-identical. The default per-sample window (`[startedAt, endedAt)`) is applied *unconditionally*, including the single-id legacy case. This is a no-op only if every legacy sample already falls within `[startedAt, endedAt)`. Two boundary divergences exist:
   - A sample with `timestamp === endedAt` is now **excluded** (half-open upper bound) where a no-`to` read previously returned it.
   - The raw path currently has **no garbage/epoch-0 filter** (unlike the SQL path's `garbageBoundParam`). Defaulting `fromMs = startedAt` will now **drop** any epoch-0 / pre-start garbage samples that the raw path previously emitted.

   Both are arguably improvements and almost certainly negligible in practice, but they mean the claim is "behaviorally equivalent for in-window data," not literally byte-identical. **Recommendation:** keep the unconditional design (single source of truth is worth it), but have manual-verification step (1) deliberately target a legacy session known to contain boundary/garbage samples, so the verifier confirms the delta is acceptable rather than assuming zero delta.

2. **ROW_CAP false-413 risk grows for root-bound reads.** When a child reads with no `from`/`to`, the coarse `flushedAt` filter intentionally does not fire, so the query fetches **all** of the root's bio batches (across all children) before the per-sample window trims to the child's slice. `take: ROW_CAP = 60_000` is unchanged. A long root with many children could approach 60k batch rows more easily than today's child-only read, throwing a 413 where the legacy path would not. Acceptable for now (the plan explicitly keeps the guards unchanged), but worth noting as a scaling watch-item once ingest flips to root in Phase 58's second task.

3. **Call-site signature update is implicit.** Task 1 says to extend `aggregateBiometrics`'s signature to take `bioSessionIds`, but does not spell out updating the call at lines 173–179 to pass it. TypeScript will force this, so it is not a real risk — just call it out so the implementer threads the new argument through the call site.

4. **SQL `= ANY($n)` uuid array binding.** The plan correctly relies on node-postgres serializing the JS `uuid[]` to a Postgres array literal for `b."moduleSessionId" = ANY($n)`. This is a well-established working pattern; type inference resolves the array element type from the uuid column. Low risk. **Recommendation (defensive only):** if inference ever misbehaves in the target Postgres version, add an explicit `::uuid[]` cast on the bind. No action needed unless a runtime type error appears during manual verification.

## Positive Notes
- The separation of concerns is exactly right and load-bearing: the **coarse `flushedAt`** filter stays driven by the original request `fromDate`/`toDate` while only the **per-sample timestamp** filter receives the defaulted window. The plan calls this out explicitly in both Task 2 and Task 3, preventing the classic bug of trimming root batches by the child's start time.
- Half-open `[from, to)` boundary inclusivity is explicitly pinned "do not change," keeping the raw and SQL paths in lockstep with `biometric-aggregation.util.ts`.
- The non-breaking two-step rollout (tolerant read before ingest flip) is sound and correctly sequenced; the no-double-counting reasoning (one row-owner per era) is valid.
- `listInstructions` is correctly identified as out of scope and protected by an explicit guard task.
- Dependency on the `rootSessionId` column is real and already satisfied in the entity — no missing prerequisite.

## Verdict
The plan is solid: accurate codebase assumptions, correct API usage, no missing migrations (correctly deferred), no security concerns (ownership check unchanged, ids are uuid-bound parameters — no injection), and full roadmap/spec linkage. The observations above are non-blocking refinements for the manual verifier, not defects in the plan.

PLAN_REVIEW_PASS
