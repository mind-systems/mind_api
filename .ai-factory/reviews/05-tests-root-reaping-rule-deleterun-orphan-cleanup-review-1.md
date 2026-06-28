# Code Review: Tests — root reaping rule + deleteRun orphan cleanup

**Plan:** `.ai-factory/plans/05-tests-root-reaping-rule-deleterun-orphan-cleanup.md`
**Spec note:** `.ai-factory/notes/19-test-root-reaping-deleterun.md`
**Diff scope:** test-only milestone. Code changes are confined to two Jest specs:
- `src/realtime/services/session-watchdog.service.spec.ts` (+171)
- `src/sessions/sessions.service.spec.ts` (+124)

(`.ai-factory/notes/19-…md`, `.ai-factory/ROADMAP.md` and the plan/plan-review artifacts also changed — documentation, not reviewed for runtime correctness.)

## What I verified

I read both spec files in full, cross-checked them against the production code they pin (`session-watchdog.service.ts:56-91`, `sessions.service.ts:137-146`, `realtime-config.ts:14`, `activity-type.enum.ts`), and **ran both suites** to confirm the actual RED/GREEN state matches the TDD intent.

Run result: `7 failed, 25 passed`. Of the 7 failures, 6 belong to this milestone and 1 is pre-existing (`listRuns … RED until spec 07`, from the prior milestone — not introduced here). The 6 expected reds:

- **Watchdog (4):** all four `sweepEmptyRoots — root reaping rule` cases fail with `TypeError: service.sweepEmptyRoots is not a function` — RED for feature-absent, exactly as P1/L2 intend.
- **deleteRun (2):** `should delete the root after its last child is deleted` (asserts 2 deletes, gets 1) and `should count siblings after deleting the child` (asserts `count` was called + ordered after delete, `count` never called) — both RED for the right reason.

The characterization cases are GREEN as required:
- `[characterization] should leave non-root stale-session reaping behavior unchanged` — `sweep()` still fires `abandonStale`/`closeAll`, `repo.delete` untouched. ✓
- `[characterization] should behave as today for a legacy session with rootSessionId null` — single delete, `count` never called. ✓
- The protected query-construction block (`:52-110`, P2) stays GREEN — the new `count`/`delete` repo mocks are additive and `sweep()` is never re-pointed. ✓

The compile-now approach is sound: `makeRoot()` casts `activityType: 'root' as any` / `rootSessionId: null as any`; deleteRun fixtures inject `rootSessionId` via `...({ rootSessionId } as any)` spread (excess-property checks don't fire on an `any` spread, so it type-checks); the new method is reached via `(service as any).sweepEmptyRoots()`. The whole suite compiles, so no characterization case is collaterally reddened by a type error.

## Findings

### 1. (Important) The `keep the root when a sibling remains` target case is GREEN now — it does not flip, and it never verifies that siblings were consulted

`src/sessions/sessions.service.spec.ts` — `[RED until spec 15-deleterun-orphan-root-cleanup] should keep the root when a sibling child remains`.

This case is labelled a target (`RED until spec 15`) but **passed in the run** — it is not in the failed set. The reason: today's `deleteRun` already performs exactly one delete (the child) and never touches the root, which is bit-for-bit what the test asserts:

```ts
expect(repoWithCount.delete).toHaveBeenCalledTimes(1);
expect(repoWithCount.delete).toHaveBeenCalledWith({ id: 'child-session-id' });
expect(repoWithCount.delete).not.toHaveBeenCalledWith({ id: ROOT_ID });
```

Two consequences:

- **Mislabelled / no RED→GREEN transition.** The spec's L1 and the plan's Task 5 require every target case to be "RED for the right reason now." This one is GREEN now and stays GREEN after spec 15 — it is really a guard, not a target.
- **It does not pin the behavior it claims to.** The defining act of the keep-path in spec 15 is *consulting the sibling count and deciding to keep*. Because the test never asserts `count` was called, a spec-15 implementation that keeps the root without ever checking siblings (or one that short-circuits the whole sibling logic) would still pass. The companion `delete-the-root` and `count-after-delete` cases are properly RED, so the count mechanism is exercised elsewhere — but this specific keep-path assertion is weaker than the milestone's own P4 contract ("counts remaining siblings via `count({ where: { rootSessionId } })`").

**Recommendation:** add a positive assertion that the sibling count was consulted on the keep-path, e.g.

```ts
expect(repoWithCount.count).toHaveBeenCalledWith({ where: { rootSessionId: ROOT_ID } });
```

This makes the case RED now (today's code never calls `count`) and GREEN only once spec 15 actually checks siblings before retaining the root — restoring the RED→GREEN transition and aligning with P4. (Keep the existing `times(1)` / `not…ROOT_ID` assertions; they remain valuable over-deletion guards.)

### 2. (Minor / nit) `should reap a childless root … even if it has bio` does not model bio

`src/realtime/services/session-watchdog.service.spec.ts` — the fixture has no bio representation; the "even if it has bio" clause is asserted only by the test name. This is *correct in substance* — the reap predicate is child-count-only and bio lives in a separate table (`bio_session_samples`), so bio is deliberately not a unit-visible input and cannot be modelled at this layer. No change required; flagging only so a future reader doesn't add a phantom `bio` field expecting it to matter. The inline comment ("bio no longer protects") already documents intent adequately.

### 3. (Informational) The four watchdog target cases are RED via `TypeError`, not via a failed assertion

Because `sweepEmptyRoots()` does not exist, the three "should NOT reap" guard bodies (`expect(wasDeleted || wasAbandoned).toBe(false)`) never actually execute until spec 08 adds the method — the call throws first. This is explicitly the plan's chosen signal (P1/L2: "method does not exist yet → TypeError → RED for feature-absent") and is acceptable. The practical note for the spec-08 implementer: those guard assertions get their *first real exercise* the moment the method lands, so spec 08's verification run must re-confirm they turn GREEN for the right reason (root genuinely not reaped) rather than merely stop throwing. No change needed here.

### 4. (Informational) Suite is intentionally committed RED — consistent with repo convention

Both files now ship failing target cases, matching the established pattern (`multi-session-lifecycle.spec.ts`, `concurrency-idempotency.spec.ts`, and the pre-existing `listRuns` RED-until-spec-07 already in `sessions.service.spec.ts`). `npm test` / CI will show reds until specs 08 and 15 land; that is the documented TDD signal for this track, not a regression. Noted so the red count is not mistaken for a defect.

## Summary

No runtime bugs, no security surface, no migration/type hazards — the diff is test-only and the production code it guards (the self-referential `ON DELETE CASCADE` reap predicate) is correctly treated as the highest-blast-radius concern. Mechanism pins P1–P4 are honoured and the RED/GREEN split is almost entirely correct as verified by an actual run.

The one substantive issue is **Finding 1**: a target case that is GREEN now and does not assert the sibling-count consultation it is meant to pin. Resolving it (one added `expect(count).toHaveBeenCalledWith(...)`) restores the RED→GREEN contract for the deleteRun keep-path. Findings 2–4 are informational.
