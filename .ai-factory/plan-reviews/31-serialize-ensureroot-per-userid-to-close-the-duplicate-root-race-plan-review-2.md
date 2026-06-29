# Plan Review 2: Serialize `ensureRoot` per userId to close the duplicate-root race

**Plan:** `31-serialize-ensureroot-per-userid-to-close-the-duplicate-root-race.md`
**Target:** `mind_api/src/realtime/services/activity-engine.service.ts` (+ spec)
**Risk Level:** 🟢 Low

## Verdict

The plan is solid and ready for implementation. This is the second review pass: all four
non-blocking findings from review 1 have been folded into the plan text, and re-verification
against the live source confirms the file paths, line references, store API usage, and test
design are all accurate. No new issues.

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** PASS. The change is contained entirely within
  `ActivityEngine` and the existing `ActivitySessionStore` public API. No module boundary
  crossed, no new provider, no cross-module entity/repo injection. Consistent with the
  modular-monolith rule.
- **Rules (`RULES.md`):** PASS. `RULES.md:3` forbids the non-null assertion operator (`!`).
  The current source carries exactly one such violation at `activity-engine.service.ts:79`
  (`this.activitySessionStore.getRootId(userId)!`); Task 1 explicitly removes it and replaces
  it with a `const rootId = getRootId(userId); if (!rootId) return null;` guard. Net rules
  posture improves. Logging stays lean (preserves the single `Root session created` log, adds
  none) per the plan's Settings block.
- **Roadmap (`ROADMAP.md`):** PASS. Matches the open task verbatim at `ROADMAP.md:106`
  ("Serialize `ensureRoot` per userId to close the duplicate-root race") under the
  "Cleanup + race fix" section. The no-migration / no-DB-unique-index / in-process-lock-only
  scope matches the roadmap entry exactly ("In-process lock only — **no** DB unique index …
  janitor unchanged"). Spec note `43-serialize-ensureroot-race.md` is referenced.

## Correctness Re-verification (against live source)

- **TOCTOU confirmed real.** `ensureRoot` (`:77-90` check, `:92-117` create) does
  `getRoot` → `await repo.save` → `setRoot`. With an `await` between the check and the
  `setRoot` write, two concurrent connects for one user both pass the empty-store check and
  each mint a root; the second `setRoot` orphans the first row. Diagnosis is accurate.
- **Fix mechanism is correct for Node's single-threaded model.** The join-path read
  (`ensureRootInFlight.get`) and the `set` happen with no `await` between them, and `setRoot`
  runs only after `repo.save` resolves, so a concurrent caller deterministically observes and
  joins the in-flight promise. `try { return await p } finally { delete }` clears the map on
  both resolve and reject — no poisoning of retries after a failed create, no entry leak.
- **Store API usage matches the implementation.** `setRoot(userId, sessionId, state?)` writes
  `rootSessionId` and `root` together atomically (`activity-session-store.service.ts:65-73`);
  `getRoot` reads `.root` (`:75-77`) and `getRootId` reads `.rootSessionId` (`:79-81`). So in
  production `getRoot` truthy ⟺ `getRootId` truthy — the `reconstructRoot` defensive `null`
  branch is effectively dead but harmless, exactly as the plan describes.
- **Synthesized fast-path shape preserved.** Task 1's field list (`id, userId,
  activityType: ROOT, activityRefId: undefined, rootSessionId: null, status: ACTIVE,
  startedAt, lastActivityAt` cast `as ModuleSession`) is byte-for-byte the inline object at
  `:80-89`. Behavior-preserving.

## Review-1 Findings — resolution check

- **Finding 1 (sync helper can't "fall through to create"):** Resolved. Task 1 now specifies
  `reconstructRoot` returns `ModuleSession | null` and Task 2's fast path does
  `const r = this.reconstructRoot(userId, existing); if (r) return r;` before falling into the
  create path. Ownership of the create is correctly the caller's.
- **Finding 2 (characterization test must use real `setRoot`):** Resolved. Task 3 now commits
  to pre-seeding via the real store's `setRoot('u', '<root-id>', state)` so both `getRoot` and
  `getRootId` return consistently, and explicitly warns against the bare `getRoot` stub. This
  matches the real store semantics (`setRoot` sets both fields).
- **Finding 3 (id-equality is not the RED discriminator):** Resolved. Task 3 designates the
  `repo.create`/`repo.save` call-count assertions (once vs. pre-lock twice) as the primary
  RED→GREEN discriminator and demotes `a.id === b.id` to a secondary check, noting it holds
  even in the RED state because both `save` calls resolve to the same mock.
- **Finding 4 (existing regression coverage safe):** No plan change required; the fast path is
  preserved so `multi-session-lifecycle.spec.ts`'s single-root reuse test stays GREEN.

## Test-design verification

The spec helpers the plan reuses all exist as described in
`activity-engine.service.spec.ts`: `makeRepo` (`create/save/findOne/update` jest fns),
`makeActivitySessionStore` (real `ActivitySessionStore` with a stubbed `ConfigService`),
`makeEmitter`, `makeStreamEngine`, `makeSession`, and the 4-arg
`new ActivityEngine(repo, store, emitter, streamEngine)` construction. The target test's
`Promise.all([ensureRoot('u'), ensureRoot('u')])` with a real (initially empty) store exercises
exactly the join interleaving the lock closes. Test design is sound.

## Scope Note (accepted design, not a defect)

The in-process `Map` lock collapses only *simultaneous* creates within one Node process; it
does not serialize across multiple API instances. The plan and roadmap explicitly accept this
(no DB unique index; multiple roots per user over time are legitimate; janitor reaps orphans).
Correct for the current single-instance deployment. If the API is ever horizontally scaled the
duplicate-root race reopens and would need a DB-level guard — future awareness only, no action
for this task.

## Conclusion

No missing steps, no wrong codebase assumptions, no architectural mistakes, no missing
migration, no security issue, no incorrect file paths or API usage. All review-1 findings are
addressed in the plan text. Cleared to implement.

PLAN_REVIEW_PASS
