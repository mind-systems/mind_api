# Plan Review — 04-tests-root-excluded-from-stats-run-history

**Plan:** `.ai-factory/plans/04-tests-root-excluded-from-stats-run-history.md`
**Target spec:** note `18-test-root-stats-exclusion.md` (covers feature note `07-exclude-root-from-stats.md`)
**Risk Level:** 🟡 Medium

## Verification done

Read every file the plan touches and cross-checked all line references against source:

| Claim in plan | Source | Verdict |
|---|---|---|
| `StatsWorker` ctor single-arg (`stats.worker.ts:11`) | confirmed | ✅ |
| `onSessionAbandoned(event)` calls `finalise` | `stats.worker.ts:32-49` | ✅ |
| `makeStatsService()` spies `finalise`, `makeEvent()` shape | `stats.worker.spec.ts:5-20` | ✅ |
| `ActivityType` enum has only `BREATH`,`MEDITATION` (no `ROOT`) | `activity-type.enum.ts:1-4` | ✅ |
| `SessionEvent.startedAt/endedAt` are real `Date` | `stats.service.ts:9-16` | ✅ |
| min-duration early-return inside `finalise` | `stats.service.ts:45-50` | ✅ |
| Bio engine `onSessionAbandoned({sessionId})` → `flush(sessionId)` | `biometric-stream-engine.service.ts:216-226` | ✅ |
| `new BiometricStreamEngine(repo, moduleSessionRepo, config)` | `…service.spec.ts:51-58` | ✅ |
| `SessionsService` 3-repo ctor | `sessions.service.ts:50-57` | ✅ |
| `listRuns` chain + `getCount`/`getRawAndEntities`, `endedAt IS NOT NULL` at `:89` | `sessions.service.ts:78-97` | ✅ |
| `'root' as any` precedent | `multi-session-lifecycle.spec.ts` exists | ✅ |
| Task 4 sub-threshold char case already exists | `stats.service.spec.ts:98-106` | ✅ (handled by the "tag, don't duplicate" branch) |

Line references are unusually accurate. L2 compile-now (`'root' as any`), real-Date fixtures, and the four-lesson constraints are all faithful to the codebase. Tasks 1, 2, and 4 are sound and implementable as written.

## Context Gates
- **Architecture:** `.ai-factory/ARCHITECTURE.md` present — no boundary violation; the plan only adds `describe/it` blocks to existing co-located specs. **PASS**
- **Rules:** `.ai-factory/RULES.md` present — nothing test-authoring-relevant conflicts. **PASS**
- **Roadmap:** `.ai-factory/ROADMAP_TESTS.md` present but effectively empty (5 lines, no milestone entries). Its one substantive line is a hard constraint: *"Instantiate via `new X(mock)` or `Test.createTestingModule` — **no real DB**, no real gRPC."* This directly bears on the critical issue below. **WARN** — milestone 04 has no roadmap entry to link against, and the "no real DB" rule constrains the fix options for Task 3.

## Critical Issues

### 1. Task 3 (`listRuns` root-exclusion) target test can never go GREEN under spec 07's actual implementation — and pressures spec 07 toward a buggy implementation

This is the one substantive defect and it is inherited straight from note 18, so the plan reproduces it faithfully rather than introducing it — but it must be resolved before this test is written.

**The mismatch.** Feature note `07-exclude-root-from-stats.md:23-26` specifies the run-history exclusion as a **SQL-level** filter:
```ts
.andWhere('ms.activityType != :root', { root: ActivityType.ROOT })
```
The plan's Task 3 mandates a **fully mocked QueryBuilder** where "every builder method returns the QB" and `getRawAndEntities` resolves seeded `{ entities, raw }`, plus an **outcome-only** assertion (`result.items.some(i => i.activityType === 'root')` is `false`) and explicitly forbids asserting the where-clause.

With a fully mocked QB, `.andWhere(...)` is just a stub returning `this`; it has **zero** effect on what `getRawAndEntities` returns. `listRuns` then maps *every* returned entity into `items` (`sessions.service.ts:99-113` — no JS-side filtering). Therefore:
- **Now (no filter):** seed root+breath → root appears in `items` → RED. ✓ correct reason.
- **After spec 07 adds the `andWhere`:** the mock still returns the seeded root row → root still in `items` → **STILL RED.**

So the target case is **permanently RED** once the feature is implemented the way spec 07 dictates. This contradicts the plan's own stated end-state (Notes §54: "target … RED for the right reason … all characterization cases … GREEN" — implying targets flip GREEN after spec 07) and note 18's Red/Green contract.

**Why this is worse than a no-op test.** A spec-07 implementer running this failing unit test will see it stay red after adding the SQL `andWhere`, and the most likely "fix" is to filter in JS (e.g. `entities.filter(e => e.activityType !== ROOT)`) to satisfy the mock. That is an architectural regression: it filters **after** `getCount()` and `take/skip`, so `total` is inflated by roots and each page returns fewer than `take` rows. The test as designed actively steers the feature toward a pagination bug.

**Why the obvious escape hatches are closed:**
- An e2e/real-DB test would exercise the real WHERE — but `ROADMAP_TESTS.md` mandates *"no real DB"* for this suite.
- Asserting the `.andWhere(...)` invocation (a structural assertion) would work at unit level — but both the plan and note 18 explicitly forbid asserting the query-builder clause.

**Recommended resolution (pick one, then update both the plan and note 18 so they agree):**
1. **Relax the outcome-only rule for this single query-level case** and assert the builder contract: that `listRuns` issues an `andWhere` carrying an `activityType != root` condition (e.g. capture `andWhere.mock.calls` and assert one call's SQL fragment references `activityType` and the bound `root` param). This is the only way a mocked-QB unit test can characterize a SQL-level filter. Yes, it inspects the clause — but the alternative (outcome-only over a mock that ignores the clause) is untestable by construction.
2. **Move only the `listRuns` root-exclusion case to an e2e/integration spec** with a real (or sqlite-in-memory) DB, and amend `ROADMAP_TESTS.md`'s "no real DB" rule to carve out this case. Keep Tasks 1/2/4 as mocked unit tests.
3. **Explicitly accept permanent-RED** for this one case and document it as a known limitation (NOT recommended — it defeats the milestone's success criteria and the escalation valve will misfire).

Note: Tasks 1 (stats finalise spy) and 2 (bio flush spy) do **not** have this problem — they drive real handler code paths where a guard in `StatsService.finalise` genuinely flips the spy outcome. The defect is specific to Task 3 because the exclusion is implemented as SQL the mock cannot observe.

## Non-blocking Issues (WARN)

### 2. Task 2 label is self-contradictory: "Target → RED until spec 07" on a test that is GREEN now and must stay GREEN
The plan (Task 2) tells the implementer to label the bio-flush case `RED until spec 07-exclude-root-from-stats` (per L3) while in the same paragraph stating "this passes today … it must remain GREEN through spec 07." A case cannot be both "RED until spec 07" and "GREEN now and through spec 07." This will confuse the implementer about whether a green result is a pass or a failure, and it muddies the L4 escalation signal. **Recommend:** label it as a characterization/invariant (e.g. `should still flush the bio buffer on a root ABANDONED — invariant guarding spec 07 against over-guard`), not "RED until". Note 18 line 33 carries the same mislabel; fix it there too for consistency.

### 3. Task 1 breath characterization duplicates an existing test
The proposed `should still call finalise for an ABANDONED breath session` is functionally identical to the existing `stats.worker.spec.ts:38-43` ("calls finalise with correct payload on session.abandoned"), which already drives `onSessionAbandoned` with a `BREATH` event. Only the `meditation` variant adds new coverage. **Recommend:** drop the breath duplicate (or fold it in as a comment referencing the existing case) and keep only the meditation characterization, to honor the plan's own "do not rewrite/duplicate existing cases" guidance.

## Positive Notes
- Exceptional pin accuracy — every constructor arity, handler signature, and line range checked out against source. The implementer can act on this plan without re-discovering the code.
- Correct identification of the over-guard twin risk: stats and bio flush are independent `@OnEvent(ABANDONED)` subscribers (confirmed `stats.worker.ts:32` vs `biometric-stream-engine.service.ts:216`), and spec 07 confirms the guard belongs only in `StatsService.finalise`. Task 2 guards exactly the right invariant.
- L2 compile-now discipline (`'root' as any`) is correct and necessary — `ActivityType.ROOT` genuinely does not exist yet, so importing it would break compilation.
- Task 4 correctly recognizes the min-duration filter lives inside `finalise` (not the worker) and must be driven against the real service; it also correctly anticipates the pre-existing `stats.service.spec.ts:98-106` case and chooses tag-don't-duplicate.

## Required before implementation
Resolve Critical Issue #1 (choose a resolution path for the `listRuns` target case and reconcile the plan with note 18 and `ROADMAP_TESTS.md`). Issues #2 and #3 are quick label/dedup fixes that should be folded in at the same time.
