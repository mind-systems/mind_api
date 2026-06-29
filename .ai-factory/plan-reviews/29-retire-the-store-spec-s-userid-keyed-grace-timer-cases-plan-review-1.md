# Plan Review: Retire the store spec's userId-keyed grace-timer cases

**Plan:** `.ai-factory/plans/29-retire-the-store-spec-s-userid-keyed-grace-timer-cases.md`
**Target file:** `src/realtime/services/activity-session-store.service.spec.ts` (test-only)
**Risk Level:** 🟢 Low

## Verification performed

- Read the full target spec, the service under test (`activity-session-store.service.ts`), and the coverage-reference spec (`multi-session-lifecycle.spec.ts`).
- Confirmed every line number cited in the plan against the actual file (all accurate).
- Confirmed the source note (`notes/41-...`) and downstream milestone (`notes/42-...`) the plan is sequenced against.
- Grepped the whole `src` tree for userId-keyed trio usage outside the spec.

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md` present): WARN — no boundary impact. Test-only change inside the realtime module; no module-dependency or contract change. ARCHITECTURE has no entry on the grace-timer API, so nothing to align.
- **Rules** (`.ai-factory/RULES.md` present): WARN — RULES forbids the non-null assertion operator (`!`). Not triggered by the plan as written; the existing spec uses `as any` casts, not `!`. Flagging only so the rewrites don't introduce `!` (e.g. when re-expressing `store.get(...)!`). Other rules (no sensitive logging, gRPC `@Payload()`) are not relevant to this spec.
- **Roadmap** (`.ai-factory/ROADMAP.md` present): PASS — milestone is present and linked (ROADMAP.md:104, "Retire the store spec's userId-keyed grace-timer cases"), and its ordering constraint ("must land before" the code deletion at ROADMAP.md:105) matches the plan's framing around `[[42-remove-userid-keyed-grace-trio]]`.

## Critical Issues

None. The plan is correct on file paths, API surface, line numbers, sequencing, and the "no migration / no docs / no logging" classification.

## Important Notes (non-blocking)

### 1. Tasks 3–4 overstate how much the multi-session spec already covers the `*ForSession` API

This is the one substantive risk. The plan repeatedly justifies deletion with "already covered in `multi-session-lifecycle.spec.ts`." In fact the **store-level** `*ForSession` coverage there is essentially a *single* test (`multi-session-lifecycle.spec.ts:185-213`), which covers only: two-session independence, expiry/firing, and mid-flight `hasPendingGraceTimerForSession === true`. The engine-level target tests (`:583-698`) cover per-session timer creation on disconnect and cancellation-on-reconnect, but only as a side effect of engine flows.

The following userId-keyed invariants have **no** equivalent `*ForSession` coverage anywhere and must therefore be **rewritten, not deleted** (per the plan's own Scope-note confirm-before-drop rule):

- **Phase 7 — replace-on-same-key** (`:262-285`): second `start...` for the same key cancels the first; only the latest callback fires. Not covered for `*ForSession`.
- **Phase 8 — post-expiry cleanup** (`:295-313`): `hasPending... === false` *after* the timer fires, and a fresh timer can be started for the same key. The multi-session test only asserts `=== true` mid-flight, never `=== false` post-fire at the store level.
- **Phase 9 — void/Promise semantics** (`:323-347`): `onExpiry` returning a resolved Promise still fires once, removes the entry, and does not block re-scheduling. Not covered anywhere for `*ForSession`. This is a genuine behavior of the live `startGraceTimerForSession` (`void onExpiry()`, service `:167-170`).
- **Phase 10 — cancel-independence** (`:387-401`): cancelling session-A leaves session-B's pending timer intact and firing. The multi-session test covers *expiry*-independence (`:185-213`), not *cancel*-independence. Easy to mistakenly drop this case thinking expiry-independence covers it — it does not.
- **Phase 11 — cancel no-op when absent** (`:426-428`) and **cancel-doesn't-touch-state** (`:430-436`): no `*ForSession` equivalent.

The plan's global confirm-before-drop rule (Scope note, lines 22–23) is the correct safety net and, if followed literally, produces the right outcome. The concern is that Task 4's specific wording ("the independence/expiry mechanism is covered… should already be (or be made) covered") leans toward *delete*, which could lead an implementer to drop these wholesale. Recommend the implementer treat Phases 7–12 as **predominantly a rewrite onto `*ForSession`**, deleting only the cases whose invariant is provably duplicated (essentially just the plain expiry-independence case). Rewriting is genuinely valuable here: these invariants apply equally to the surviving `*ForSession` API and are currently untested for it, so the rewrite *adds* coverage rather than merely relocating it.

### 2. Confirm the referenced coverage actually passes, not just exists

The "already covered" claims lean on `multi-session-lifecycle.spec.ts:185-213`, which lives in a `describe('target — … [RED until Phase 55]')` block. The service already implements `startGraceTimerForSession` / `getSoleChild` / `setRoot` / `addChild`, so those target tests should now be GREEN — but the plan's Task 5 only runs the single store spec. A one-line confirmation that the referenced multi-session cases are green would harden the confirm-before-drop reasoning. Cheap to add to Phase 3.

## Positive Notes

- **Caught a gap in the source note.** Note 41 enumerated only the `:226+` / `:257+` / `:288+` describes plus constructor/`set()`/`delete()` cases; the plan's Scope note correctly recognises the trio is used through Phase 12 (`:455+`) and treats the zero-match grep as the authoritative scope. Without this, Phases 9–12 would have been orphaned and `[[42]]` would have red the suite. This is exactly the right call.
- **Sequencing is correct.** Retiring the spec usage before deleting the methods is the safe order; reversing it reds the suite. Matches ROADMAP.md:104–105.
- **Deletion is provably safe.** Grep over `src/` confirms the userId-keyed trio has no external caller — the only non-spec reference is the trio's own internal `this.cancelGraceTimer(userId)` self-call (service `:141`). So `[[42]]`'s method deletion will not orphan production code, and this plan fully clears the test side.
- **Config assertions are preserved correctly.** Task 1 re-expresses the default-30000ms and custom-`WS_RECONNECT_GRACE_MS` boundary assertions (29_999/+1, 4_999/+1) through `startGraceTimerForSession`, exploiting the shared `graceMs` field (service `:17`, `:20-22`, `:170`). This keeps the config coverage that Phase 6's deletion would otherwise drop.
- **Out-of-scope boundaries are explicit and correct** — `get`/`has`/`set`/`delete`/`size` state cases and root/child accessors are correctly fenced off.

## Recommendation

The plan is solid and safe to implement. The only adjustment worth making before/during implementation is to lean on the confirm-before-drop rule for Phases 7–12 and **rewrite** (not delete) the replace-semantics, post-expiry-false, void/Promise, cancel-independence, and cancel-no-op invariants onto the `*ForSession` API, since none of them are covered elsewhere. This is already permitted (indeed required) by the plan's own Scope note; the notes above just make the at-risk cases explicit so they aren't lost.

PLAN_REVIEW_PASS
