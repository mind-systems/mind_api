# Plan Review 2 — 04-tests-root-excluded-from-stats-run-history

**Plan:** `.ai-factory/plans/04-tests-root-excluded-from-stats-run-history.md`
**Target spec:** note `07-exclude-root-from-stats.md` (test milestone tracked in `18-test-root-stats-exclusion.md`)
**Risk Level:** 🔴 High — one blocking defect that makes a target test permanently RED, contradicting the milestone's own success criteria.

## What changed since review-1

The revised plan correctly resolved all three issues raised in review-1:

| review-1 issue | Status in this revision |
|---|---|
| #1 Task 3 outcome-only test permanently RED | **Resolved.** Task 3 now adopts review-1's resolution path #1 — a builder-contract assertion (`qb.andWhere.mock.calls.some(([sql]) => /activityType/.test(sql) && /!=/.test(sql))`), carved out explicitly in constraint L1 (line 12) and justified in the "Why outcome-only is untestable here" block. This case is genuinely RED now and flips GREEN once spec 07 adds `.andWhere('ms.activityType != :root', …)`. ✅ |
| #2 Task 2 mislabel ("RED until" vs invariant) | **Resolved.** Task 2 is now labelled "invariant guarding spec 07 against over-guard" and explicitly states it is *not* a "RED until" target. ✅ |
| #3 Task 1 breath duplicate | **Resolved.** Task 1 now says "Do NOT add a `breath` characterization variant" and points at the existing `stats.worker.spec.ts:38-43`. ✅ |

## Verification done

Re-read every touched file and cross-checked all line references. All pin claims are accurate:

| Claim in plan | Source | Verdict |
|---|---|---|
| `StatsWorker` single-arg ctor, `makeStatsService()` spies `finalise` | `stats.worker.ts:11`, `stats.worker.spec.ts:5-9` | ✅ |
| `onSessionAbandoned(event)` calls `finalise` unconditionally | `stats.worker.ts:32-49` | ✅ |
| min-duration early-return inside `finalise` | `stats.service.ts:45-50` | ✅ |
| Existing sub-threshold char case asserts `transaction` not called | `stats.service.spec.ts:98-106` | ✅ (Task 4 "tag don't duplicate") |
| Bio engine `onSessionAbandoned({sessionId})` → `flush(sessionId)`, separate `@OnEvent` | `biometric-stream-engine.service.ts:216-226` | ✅ |
| `SessionsService` 3-repo ctor | `sessions.service.ts:50-57` | ✅ |
| `listRuns` chain, only `where(userId)`+`andWhere(endedAt)` today | `sessions.service.ts:78-90` | ✅ |
| `'root' as any` precedent | `multi-session-lifecycle.spec.ts:679,711,…` | ✅ |
| **Spec 07 guards inside `StatsService.finalise`, not the worker** | `07-exclude-root-from-stats.md:18-22` | ✅ — and this is the crux of the blocking issue below |

## Context Gates

- **Architecture:** `.ai-factory/ARCHITECTURE.md` present — plan only adds `describe/it` blocks to co-located specs; no boundary violation. **PASS**
- **Rules:** `.ai-factory/RULES.md` present — nothing test-authoring-relevant conflicts. **PASS**
- **Roadmap:** `.ai-factory/ROADMAP_TESTS.md` present; its one hard constraint — *"Instantiate via `new X(mock)` or `Test.createTestingModule` — no real DB, no real gRPC"* (line 3) — is respected by all four tasks. No milestone-04 entry to link against. **WARN** (non-blocking, unchanged from review-1).

## Critical Issues

### 1. (BLOCKING) Task 1's root-skip target test is at the wrong layer — it is permanently RED under spec 07's chosen guard placement

This is the **same defect class** review-1 flagged for Task 3, now present in **Task 1** — and review-1 explicitly (and incorrectly) cleared Task 1 at its line 62: *"Tasks 1 … do not have this problem — they drive real handler code paths where a guard in `StatsService.finalise` genuinely flips the spy outcome."* That claim is wrong, and the revised plan carried the defect through unchanged.

**The mismatch.** Task 1 (file `src/stats/stats.worker.spec.ts`) drives `worker.onSessionAbandoned(rootEvent)` and asserts `expect(statsService.finalise).not.toHaveBeenCalled()`. But:

- In the worker spec, `statsService` is a mock whose `finalise` is `jest.fn()` (`stats.worker.spec.ts:5-9`). The **real** `finalise` body never runs.
- `StatsWorker.onSessionAbandoned` calls `await this.statsService.finalise(event)` **unconditionally** — there is no guard in the worker (`stats.worker.ts:32-49`).
- Spec 07 places the guard at the **top of `StatsService.finalise`**, explicitly *not* in the worker: *"Guarding in the service covers all three worker handlers in one place … pick the service to avoid triplicating the check"* (`07-exclude-root-from-stats.md:18-22`).

So the worker calls the (mocked) `finalise` spy for a root regardless of spec 07. The spy records the call. `expect(finalise).not.toHaveBeenCalled()` fails:

- **Now:** worker calls finalise → spy called → RED.
- **After spec 07:** spec 07 does not touch the worker → worker still calls finalise → spy still called → **STILL RED.**

The target case is **permanently RED**, which directly contradicts the plan's own stated end-state (Notes, lines 58-59: *"RED for the right reason now, flips GREEN after spec 07: Task 1 root-skip (`finalise` not reached for a root)…"*). Under spec 07's design, `finalise` **is** reached for a root — it is reached and then early-returns internally. The worker-spy can never observe that early return.

**Why the plan's L1 framing makes this invisible.** Constraint L1 (line 12) is built on the premise that the guard prevents `finalise` from being *reached*. For the stats path that premise is false: spec 07 guards *inside* `finalise`, so the only outcome-level observable is the **`user_stats` write being skipped**, which is observable only by driving the real `StatsService.finalise` (Task 4's approach) — never by the worker spy. The "finalise was/wasn't reached" observable is the wrong observable for this feature's chosen guard placement.

**Recommended resolution (pick one; reconcile plan + note 18 so they agree):**

1. **(Preferred) Re-point the Task 1 target to `src/stats/stats.service.spec.ts`** and drive the real `finalise` with a root event, asserting the row-write is skipped — i.e. `expect(repo.manager.transaction).not.toHaveBeenCalled()` (and/or `_saved` stays empty), exactly mirroring the existing sub-threshold skip at `stats.service.spec.ts:98-106`. This is RED now (no guard → transaction runs) and flips GREEN once spec 07 adds the `ActivityType.ROOT` early return — the guard and the assertion finally live at the same layer. Use a real-Date root event with duration **above** `WS_MIN_SESSION_DURATION_S` so the min-duration gate doesn't pre-empt the assertion and mask whether the root guard fired.
2. **Change spec 07 to guard each `StatsWorker` handler** instead of `finalise`. Then the worker-spy assertion in Task 1 becomes valid. **Not recommended** — spec 07 deliberately chose the service to avoid triplicating the check, and this milestone is downstream of that decision; the test suite should follow the feature, not force a feature redesign.

Either way, **plan and spec 07 currently disagree on guard placement vs. observation point** — the identical structural problem review-1 caught for Task 3, left unaddressed for Task 1.

**Knock-on note on the Task 1 meditation characterization.** Because the worker has no guard, the meditation "still finalises" worker case (line 26) is GREEN now and GREEN after spec 07 for a reason unrelated to the root exclusion — the worker forwards *every* event type to `finalise`, root included. It therefore guards nothing about spec 07 and largely re-states the existing forwarding tests (`stats.worker.spec.ts:38-43`). If Task 1's target moves to the service spec per resolution #1, the meaningful characterization counterpart ("a non-root session **does** write `user_stats`") should move there too — the existing streak/first-session cases at `stats.service.spec.ts:108-257` already cover it, so this likely collapses to a tag-don't-duplicate, not new code.

## Non-blocking Issues (WARN)

### 2. L3 label will misfire on the relabelled Task 2 invariant
Constraint L3 (line 14) mandates every *target* case carry `RED until spec 07-exclude-root-from-stats` in its `it(...)` description. Task 2 is now (correctly) an invariant, not a target, and its description omits that tag — good. Just make explicit in the plan that L3 applies **only** to the two genuine targets (Task 1 root-skip, Task 3 builder-contract) so an implementer doesn't mechanically stamp "RED until" onto the invariants and reintroduce the review-1 #2 contradiction. Minor wording; fold in with the Task 1 fix.

### 3. Task 4 assertion wording vs. the existing case
Task 4 (line 54) says to assert "the repo's `save`/manager write (`_saved` array) stays empty," but the pre-existing case it points at (`stats.service.spec.ts:98-106`) asserts `repo.manager.transaction` was not called. Both are valid skip-observables; since the plan chooses "tag, don't duplicate" when the case already exists, this is moot — just don't let an implementer add a second near-identical assertion. Non-blocking.

## Positive Notes

- Task 3's rewrite is exactly right: the "Why outcome-only is untestable here" block is precise about why a mocked QB cannot observe a SQL-level filter, and the builder-contract matcher is the only unit-level characterization that flips correctly. It also correctly warns that chasing an outcome-only red would steer spec 07 toward a post-`getCount` JS `.filter()` pagination bug.
- The over-guard twin risk (Task 2) is modelled correctly — stats and bio flush are independent `@OnEvent(ABANDONED)` subscribers (`stats.worker.ts:32` vs `biometric-stream-engine.service.ts:216`), and spec 07 confirms the guard belongs only in `StatsService.finalise`, leaving the bio path untouched.
- Pin accuracy remains exceptional — every constructor arity, handler signature, and line range checked out against source.
- L2 compile-now discipline (`'root' as any`, real-Date fixtures) is correct and necessary; `ActivityType.ROOT` genuinely does not exist yet.

## Required before implementation

Resolve Critical Issue #1: move the Task 1 root-skip target into `stats.service.spec.ts` driving the real `finalise` (resolution #1), and reconcile the plan's end-state table (Notes lines 58-60), constraint L1 (line 12), and note 18 so they agree that the stats-exclusion target is observed via the **`user_stats` write being skipped**, not via a worker-level `finalise` spy. Issues #2 and #3 are quick wording fixes to fold in at the same time.
