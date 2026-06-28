# Code Review (round 2): Tests — root reaping rule + deleteRun orphan cleanup

**Plan:** `.ai-factory/plans/05-tests-root-reaping-rule-deleterun-orphan-cleanup.md`
**Spec note:** `.ai-factory/notes/19-test-root-reaping-deleterun.md`
**Diff scope:** test-only milestone:
- `src/realtime/services/session-watchdog.service.spec.ts` (+171)
- `src/sessions/sessions.service.spec.ts` (+129)

(Doc artifacts — note, ROADMAP, plan/plan-review/review-1 — also changed; not reviewed for runtime correctness.)

## Method

Read both spec files in full, cross-checked every pin against the production code (`session-watchdog.service.ts:56-91`, `sessions.service.ts:137-146`, `realtime-config.ts:14`), and **ran both suites** (`8 failed, 24 passed`).

### Round-1 finding resolved
Review-1's only substantive finding — the `keep the root when a sibling child remains` target case was GREEN now and never asserted the sibling count was consulted — has been **fixed**. The case now adds:

```ts
expect(repoWithCount.count).toHaveBeenCalledWith({ where: { rootSessionId: ROOT_ID } });
```

It is now in the failed set (RED now, because today's `deleteRun` never calls `count`), restoring the RED→GREEN transition and matching P4. Confirmed by the run.

### RED/GREEN state now
- **deleteRun target (3/3 RED):** delete-root-after-last-child, keep-root-when-sibling-remains, count-after-delete — all RED for the right reason. ✓
- **deleteRun characterization (GREEN):** legacy `rootSessionId: null` → single delete, `count` never called. ✓ (Correctly also forces spec 15 to special-case null, or the `not.toHaveBeenCalled()` guard reddens — good design.)
- **Watchdog target (4/4 RED):** all `sweepEmptyRoots` cases RED via `TypeError: service.sweepEmptyRoots is not a function`. ✓
- **Watchdog characterization (GREEN):** non-root stale reaping unchanged; protected `:52-110` query-construction block untouched (P2 holds). ✓
- 1 further suite failure (`listRuns … RED until spec 07`) is **pre-existing** from the prior milestone — not part of this diff.

## Findings

### 1. (Important) The `fresh lastActivityAt` target case will be RED for the *wrong* reason once spec 08 lands — the TTL guard's observability layer is unpinned

`src/realtime/services/session-watchdog.service.spec.ts:365-386` —
`[RED until spec 08] should NOT reap a childless root whose lastActivityAt is still fresh`.

The case force-feeds a **fresh** root into the candidate set via the mock, then asserts it is not reaped:

```ts
const freshRoot = makeRoot({ ..., lastActivityAt: new Date(FIXED_NOW - DEFAULT_EMPTY_ROOT_TTL_MS + 60_000) });
repo.find.mockResolvedValue([freshRoot]);   // ← unconditionally returns the fresh root
repo.count.mockResolvedValue(0);
await (service as any).sweepEmptyRoots();
expect(wasDeleted || wasAbandoned).toBe(false);
```

This only passes after the feature lands **if `sweepEmptyRoots()` re-checks `lastActivityAt` in JS after the fetch.** But the natural, idiomatic implementation — the one symmetric with the existing `sweep()` — puts the TTL predicate in the *query*:

```ts
// session-watchdog.service.ts:57-63 (existing sweep, the template spec 08 will mirror)
const threshold = new Date(Date.now() - this.maxIdleMs);
const staleSessions = await this.repo.find({
  where: { status: In([...]), lastActivityAt: LessThan(threshold) },
});
// …then reaps everything returned, with NO further lastActivityAt check
```

By that template, `sweepEmptyRoots()` filters TTL in `repo.find`'s WHERE and reaps every returned row (after the live-subscriber and childless checks). The test's mock **ignores the WHERE** and hands the loop a fresh root the real query would never return → the loop reaps it → `expect(...).toBe(false)` **fails after spec 08 ships**. That is a permanently-red target case — RED for a mock artifact, not for feature-absence.

This is precisely the trap the milestone's own philosophy calls out (note 18 / the L1 two-state rule): *"if the effect is deeper than the mock sees (… SQL `andWhere`/bulk-delete a mocked QB ignores), drive the real service or assert the builder contract."* Pins **P3** (childless-ness) and **P1/P2** (entrypoint) cover the childless and entrypoint mechanisms — `count` and `delete` are correctly mock-visible — but **nothing pins where the TTL predicate lands**, and this case silently assumes JS-side filtering.

Note the asymmetry that makes only this case fragile:
- `should reap a childless root past TTL` (line ~300) force-feeds a root that is *genuinely past TTL* and expects reap → GREEN-after regardless of whether TTL is filtered in query or JS. Robust.
- `should NOT reap … fresh` force-feeds a root that is *fresh* and expects skip → GREEN-after **only if** TTL is filtered in JS. Fragile.
- The live-subscriber skip (line ~340) is safe — that guard is an in-JS check (`hasLiveSubscriber`, line 71) the plan explicitly reuses, and the test drives it via `hasLiveSubscriber.mockReturnValue(true)`. Mock-visible. ✓

**Recommendation — convert to a single builder-contract case that pins BOTH predicates of the candidate query (record as P5 in the note and escalate to spec 08).** Replace the returned-fresh-row outcome assertion with a query-contract assertion mirroring the existing chars at `:58-77`, asserting `repo.find` was called with **both** of the following. Both are required; implementing only the first leaves a silent data-loss hole open (see below).

1. **TTL predicate — `where.lastActivityAt` is a `LessThan(new Date(FIXED_NOW - DEFAULT_EMPTY_ROOT_TTL_MS))` `FindOperator`.** Observes the TTL guard at the layer it actually lands; RED now (method absent), GREEN once spec 08 builds the query — independent of any query-vs-JS choice on the reap side. (This is the half that *will* get implemented; do not stop here.)
2. **Root-scoping predicate — `where.activityType === 'root'`** (`ActivityType.ROOT` once spec 02 lands). This half is **non-negotiable, not cosmetic** — it is the symmetric twin of this milestone's whole reason to exist. The model is two-level (`rootSessionId` points child→root; children never have children), so a spec-08 sweep that filters TTL but **forgets `activityType = 'root'`** —

   ```ts
   const roots = await this.repo.find({ where: { lastActivityAt: LessThan(threshold) } }); // BUG: no activityType
   for (const row of roots) {
     if (hasLiveSubscriber(row.userId)) continue;
     if (await this.repo.count({ where: { rootSessionId: row.id } }) > 0) continue; // "childless?"
     await this.repo.delete({ id: row.id });
   }
   ```

   — picks up a disconnected **practice child** past TTL, finds `count({ rootSessionId: child.id }) === 0` (nobody points at a *child* as their root), reads it as "childless", and **reaps a real practice session + its bio via the self-referential cascade**. Every other case in the suite stays GREEN (reap-childless passes, not-reap-≥1-child passes, live-subscriber passes, the non-root char only drives `sweep()`), so this bug ships fully green unless this assertion pins the root scoping. (If spec 08 scopes roots by `where.rootSessionId` `IsNull()` instead, assert that operator — pin the chosen root-marker form in P5 and escalate to spec 08; do not leave it unasserted.)

Both assertions live in the one query-contract case. **Doing only assertion 1 and skipping assertion 2 is the failure mode to avoid here** — it looks done, the case turns GREEN after spec 08, and the reap-a-practice cascade hole sails through. (Do **not** "fix" the original by returning `[]` for the fresh root — tautological: an empty candidate list reaps nothing and passes even a no-op `sweepEmptyRoots()`.)

### 2. (Minor / nit) `reap a childless root … even if it has bio` does not model bio
`session-watchdog.service.spec.ts` — same as review-1 Finding 2. Correct in substance (the reap predicate is child-count-only; bio lives in `bio_session_samples`, a separate table, so it is intentionally not a unit-visible input). The "even if it has bio" clause is documented only by the name/comment. No change required.

### 3. (Informational) Watchdog target reds are `TypeError`-based by design
The four `sweepEmptyRoots` cases red out at the call site (`sweepEmptyRoots is not a function`), so their guard bodies (`expect(wasDeleted || wasAbandoned).toBe(false)`) never execute until spec 08 adds the method. This is the plan's chosen signal (P1/L2). Practical consequence for the spec-08 implementer: those guard assertions get their first real exercise the moment the method lands, so spec 08's verification run must confirm they go GREEN *for the right reason* — and Finding 1 is exactly a case where "stops throwing" ≠ "passes correctly."

### 4. (Informational) Suite ships RED — intended TDD signal, consistent with convention
Both files commit failing target cases, matching `multi-session-lifecycle.spec.ts` / `concurrency-idempotency.spec.ts` and the pre-existing `listRuns` RED-until-spec-07 already in `sessions.service.spec.ts`. `npm test` / CI will show reds until specs 08 and 15 land; that is the documented signal for this track, not a regression.

## Summary

No runtime bugs, no security surface, no migration/type hazards — the diff is test-only and compiles (the suite runs). Review-1's finding is resolved, and the deleteRun half is now in good shape: all three targets RED for the right reason, characterization correctly GREEN and guarding the null-root special case.

The remaining substantive issue is **Finding 1**, which has **two halves and both must be implemented**: convert the `fresh lastActivityAt` watchdog case into a single query/builder-contract assertion that pins **(1)** the TTL predicate (`lastActivityAt = LessThan(threshold)`) — closing the "guard deeper than the mock sees" trap where the force-fed fresh row makes the case permanently RED after the feature lands — **and (2)** the root-scoping predicate (`where.activityType === 'root'`) — closing the symmetric silent-cascade hole where a spec-08 sweep missing its root filter reaps childless non-root practice sessions. Pin both as P5 and escalate to spec 08 before the feature is authored. Findings 2–4 are informational.
