# Code Review (round 3): Tests — root reaping rule + deleteRun orphan cleanup

**Plan:** `.ai-factory/plans/05-tests-root-reaping-rule-deleterun-orphan-cleanup.md`
**Spec note:** `.ai-factory/notes/19-test-root-reaping-deleterun.md`
**Diff scope:** test-only milestone:
- `src/realtime/services/session-watchdog.service.spec.ts` (+173)
- `src/sessions/sessions.service.spec.ts` (+129)

(Doc artifacts — note, ROADMAP, plan, plan-reviews, review-1/2 — also changed; not reviewed for runtime correctness.)

## Method

Read both spec files in full, cross-checked every pin against production code (`session-watchdog.service.ts:56-91`, `sessions.service.ts:137-146`, `realtime-config.ts:14`), confirmed `FindOperator` is imported (`:1`), and **ran both suites** (`8 failed, 24 passed` — 7 milestone targets RED + 1 pre-existing unrelated `listRuns` RED).

### Round-2 finding resolved
Review-2's Finding 1 — the `fresh lastActivityAt` case force-fed a fresh root through the mock and would have gone permanently RED under a query-side TTL filter — has been **fixed**. It is replaced by a builder-contract case (`:373-388`) that pins the TTL predicate at the query layer:

```ts
const lastActivityAt = repo.find.mock.calls[0][0]?.where?.lastActivityAt;
expect(lastActivityAt).toBeInstanceOf(FindOperator);
expect((lastActivityAt as any).value).toEqual(new Date(FIXED_NOW - DEFAULT_EMPTY_ROOT_TTL_MS));
```

RED now (method absent → TypeError), GREEN once spec 08 builds `repo.find({ where: { …, lastActivityAt: LessThan(threshold) } })`. P5 was added to the note with rationale and an updated expected-state matrix. The *time* half of the candidate-query contract is now correctly pinned at the right layer.

### RED/GREEN state now (verified by run)
- Watchdog target (4/4 RED): reap-childless-past-TTL, not-reap-≥1-child, not-reap-live-subscriber, TTL-query-contract. ✓
- deleteRun target (3/3 RED): delete-root-after-last-child, keep-root-when-sibling, count-after-delete. ✓
- Characterization GREEN: non-root stale reaping unchanged; legacy null-root single-delete; protected `:52-110` block. ✓

## Findings

### 1. (Important — still open) The TTL query-contract test pins the *time* predicate but NOT the *root-scoping* predicate; a spec-08 query missing `activityType = 'root'` silently reaps childless non-root practice sessions and the whole suite stays GREEN

This was raised in the prior round and folded into review-2's recommendation (assertion 2 of the "pin BOTH predicates" fix). **The code has not been updated** — I re-confirmed the builder-contract case at `session-watchdog.service.spec.ts:373-388` asserts only `where.lastActivityAt` (a `grep` for `activityType` in that case returns 0 hits):

```ts
const lastActivityAt: unknown = callArg?.where?.lastActivityAt;
expect(lastActivityAt).toBeInstanceOf(FindOperator);
expect((lastActivityAt as any).value).toEqual(expectedThreshold);
// ← nothing asserts callArg.where.activityType === 'root' (or rootSessionId IsNull())
```

So the root-scoping of `sweepEmptyRoots()`'s candidate query remains entirely unpinned — no test in the suite verifies the root sweep restricts itself to roots.

**Why this is a real silent cascade-delete hole, not cosmetic.** The model is two-level (`rootSessionId` points child→root; children never have children). A spec-08 sweep that mirrors `sweep()` but forgets the `activityType: 'root'` filter —

```ts
const roots = await this.repo.find({ where: { lastActivityAt: LessThan(threshold) } }); // BUG: no activityType
for (const row of roots) {
  if (hasLiveSubscriber(row.userId)) continue;
  if (await this.repo.count({ where: { rootSessionId: row.id } }) > 0) continue; // "childless?"
  await this.repo.delete({ id: row.id });
}
```

— picks up a disconnected **practice child** past TTL, finds `count({ rootSessionId: child.id }) === 0` (nobody points at a *child* as their root), reads it as "childless", and **deletes a real practice session + its bio via the self-referential cascade**. This is the symmetric twin of the data-loss this milestone exists to prevent ("never reap a root with a practice" → here, "never reap a practice mistaken for an empty root"). I walked every watchdog case: reap-childless passes (mock hands it a root, `count→0`), not-reap-≥1-child passes (`count→1`), not-reap-live-subscriber passes (`hasLiveSubscriber`), the non-root characterization only drives `sweep()` — so the buggy implementation ships **fully GREEN**. The note's own expected-state matrix encodes the intent ("non-root … REAP via `sweep()` (unchanged)" — never via `sweepEmptyRoots()`), but nothing enforces it.

**Recommendation:** add the second predicate to the existing builder-contract case (one line, same layer as the TTL assertion):

```ts
expect(callArg.where.activityType).toBe('root'); // ActivityType.ROOT once spec 02 lands
```

— or, if spec 08 scopes roots by `where.rootSessionId` `IsNull()`, assert that operator instead. Pin the chosen root-marker form in P5 and escalate to spec 08. It stays RED now (TypeError) and turns GREEN only if spec 08 scopes the candidate query to roots — closing the reap-a-practice cascade hole. Do **not** substitute a force-fed non-root outcome case (reintroduces the fragility review-2 removed) or return `[]` (tautological — a no-op sweep passes).

### 2. (Minor / nit) `reap a childless root … even if it has bio` does not model bio
Carried from rounds 1–2. Correct in substance — the reap predicate is child-count-only and bio lives in `bio_session_samples` (separate table), so bio is intentionally not a unit-visible input; documented by name/comment. No change required.

### 3. (Informational) Watchdog target reds are `TypeError`-based by design
The four `sweepEmptyRoots` cases red out at the call site until spec 08 adds the method, so their assertion bodies (including the query-contract one) first execute only when the feature lands. Intended per P1/L2. The spec-08 verification run must confirm each turns GREEN *for the right reason* — Finding 1 is exactly a case the suite would otherwise wave through.

### 4. (Informational) Suite ships RED — intended TDD signal
Both files commit failing target cases, matching `multi-session-lifecycle.spec.ts` / `concurrency-idempotency.spec.ts` and the pre-existing `listRuns` RED-until-spec-07. CI shows reds until specs 08/15 land; documented signal for this track, not a regression.

## Summary

No runtime bugs, no security surface, no migration/type hazards — test-only, compiles, runs. The diff has improved steadily: review-1's GREEN-now keep-path and review-2's fragile fresh-row case are both resolved, the deleteRun half is solid (three targets RED for the right reason, characterization guarding the null-root special case), and the TTL predicate is now observed at the correct (query) layer.

The one remaining substantive issue is **Finding 1**, still open in the code: the candidate-query contract pins the *time* predicate but not the *root-scoping* predicate, so the suite cannot catch a spec-08 root sweep that omits `activityType = 'root'` and consequently cascade-deletes childless non-root practice sessions. Add the `activityType`/`rootSessionId` scoping assertion to the existing builder-contract case and pin the root-marker form in P5. Findings 2–4 are minor/informational.
