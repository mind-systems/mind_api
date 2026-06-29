# Plan Review (round 2) — Tests: root id delivered on connect (plan 19)

**Plan reviewed:** `.ai-factory/plans/19-tests-root-id-delivered-on-connect.md`
**Target file:** `src/realtime/module-state.grpc.controller.spec.ts`
**Feature under test:** note 34 (`34-deliver-root-id-on-connect.md`); test spec note 31.
**Risk Level:** 🟢 Low

## Summary

This is the second-round plan. Both **critical issues** raised in plan-review-1 have been
resolved, and the fixes were verified against the actual codebase:

1. **camelCase `isRoot`** — the plan now uses `isRoot` (not `is_root`) throughout the Constraints
   block and Tasks 2–6, and adds an explicit, well-reasoned paragraph (Constraints, lines 14–15)
   explaining why the runtime key is camelCase and why `is_root` would keep the tests RED forever.
   Confirmed against note 34 §41/§47 (emission literally writes `isRoot: true`) and the generated
   stub (`proto/generated/module_state.ts:99,101` → `moduleSessionId`, `isPaused`, both camelCase).
2. **Command-routing block anti-targets** — now explicitly enumerated and assigned in **Task 7**,
   which drains the leading connect frame at the single shared seam (`setupRoutingStream()`), keeps
   `setupConnectedStream()` untouched (correctly — those tests don't assert `values` content), and
   documents the RED→GREEN-neutral reasoning.

Every `file:line` anchor the plan cites was re-verified accurate against the current files. The plan
is internally consistent with the controller's emission order and note 34's contract. It is safe to
implement.

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md` present): test-only change, single spec file, no
  module-boundary or dependency impact. No issues.
- **Rules** (`.ai-factory/RULES.md` present): the "no fresh non-null `!`" concern from round 1 is
  now folded into the plan — Constraints/Task 8 require "optional chaining throughout, no fresh `!`",
  and the new assertions use `?.` + `as any` casts. No new `!` introduced. **Aligned.**
- **Roadmap** (`.ai-factory/ROADMAP.md` + `ROADMAP_TESTS.md` present): this is the test half (note 31)
  of the root-id-on-connect feature (note 34); linkage is explicit in the plan's Context. No issue.

## Verification Performed

- **Controller `:154`** — `await this.activityEngine.ensureRoot(userId);` with the result discarded.
  Confirmed. The silent gap the milestone guards is real.
- **Controller `:126`** — `if (subscriber.closed) return;` immediately after the `handleReconnect`
  await. Task 8 now cites `:126` (round-1 nit about the stale `:153` cite is fixed).
- **Controller `:153`** — second `if (subscriber.closed) return;` guard before `ensureRoot`.
- **Emission order** — RESUMED (`:138`) / ABANDONED (`:131`) emit *before* `ensureRoot` (`:154`);
  the future root frame emits *after*. This validates Tasks 3/5/6's `[RESUMED, ROOT]` /
  `[ABANDONED, ROOT]` ordering and "root frame is last" assertions. Note 34 §53/§86 agrees.
- **ABANDONED-with-clientSessionId continues to `ensureRoot`** — line 130 returns only when
  `clientSessionId` is absent; the (b)/(d) paths supply it, so control reaches `:154` and a root
  frame follows. Tasks 5(b)/6 are correct to expect the trailing root frame.
- **Note 34 contract** — root frame status is `ACTIVE` (§81), key is `isRoot` (§47), emitted once
  per connect, last on reconnect paths (§53); fresh connect → exactly one frame (§85). The plan
  matches all of these and correctly avoids over-constraining the root frame's status.
- **Spec line anchors** — `:152/:167/:168-171`, `:176-194`, `:196/:209`, `:214-233`, `:235-270`,
  `:273/:288/:289-292`, `:298/:311`, `:316/:336/:337/:346/:347-348`, `setupRoutingStream :623`,
  happy-path `:713`, `setupConnectedStream :436`, continue-routing `toHaveLength(2)` :1073 — all
  verified against the current spec.
- **Anti-target completeness** — the only connect paths that reach `:154` and assert `values`
  content are the reconnect-path tests (Tasks 1–6) and the command-routing block (Task 7).
  Authentication (returns before reconnect), setup-error (rejects before `:154`), stream-teardown
  (asserts call order, not `values`), and `handleSessionRevoked` (no `trackActivity`) are all
  correctly excluded. Enumeration is now complete.

## Minor Issues / Nits (non-blocking)

- **🟢 Flush-depth framing in Task 8 is slightly inaccurate, conclusion is correct.** Task 8 (and
  round-1's nit) say feature 34 "adds a second sequential `await` (`ensureRoot`)". In fact
  `ensureRoot` is *already* awaited today at `:154` — feature 34 only captures its result and adds a
  `subscriber.next` *after* that existing await, introducing **no new await**. The current
  command-routing tests already prove `flushMicrotasks(3)` drains past both sequential awaits
  (`handleReconnect` → `ensureRoot`), because otherwise `request.subscribe` would not be wired up
  before the test pushes a command. So the default depth of 3 is not merely "should suffice" — it is
  already empirically sufficient for the two-await chain. The plan's instruction to confirm rather
  than edit the helper is fine; just note the reasoning is stronger than stated.
- **🟢 Note 31 wording divergence (`is_root` vs `isRoot`)** is already acknowledged by the plan as a
  separate, non-blocking upstream cleanup. No action needed in this plan.

## Positive Notes

- Both round-1 blockers fixed at the root, not patched around: `isRoot` is corrected everywhere and
  justified, and the command-routing shift is handled at one harness seam rather than ~30 edits.
- "Distinguish by field, never by ordering" is elevated to a top-level Constraint and reinforced in
  Tasks 2/3 with a companion falsy-on-child assertion — exactly the right discriminator discipline.
- Cross-epic coordination with note 28 (the `:152-174` RESUMED test also being a pause-integrity
  anti-target) is explicitly preserved.
- Single-file scope, no production/proto/migration changes, clean two-commit split, RED-now /
  compile-now strategy intact and correctly reasoned.

## Verdict

The plan is solid. Both critical issues from round 1 are resolved and verified; the remaining items
are trivial wording nits with no impact on implementation. Safe to implement.

PLAN_REVIEW_PASS
