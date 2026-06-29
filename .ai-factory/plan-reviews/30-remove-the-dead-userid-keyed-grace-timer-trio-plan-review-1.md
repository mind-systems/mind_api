# Plan Review: Remove the dead userId-keyed grace-timer trio

**Plan:** `30-remove-the-dead-userid-keyed-grace-timer-trio.md`
**Risk Level:** 🟢 Low

## Verification Against Codebase

All claims in the plan were checked against `src/realtime/services/activity-session-store.service.ts` and the wider repo:

- **Line numbers are exact.** The section comment is at `:138`, `startGraceTimer` at `:140-147` (with the `this.cancelGraceTimer(userId)` self-call at `:141`), `cancelGraceTimer` at `:149-154`, `hasPendingGraceTimer` at `:156-158`. The sessionId-keyed trio is at `:162-183` as stated.
- **Deletion is provably safe.** Repo-wide grep for `\.(startGraceTimer|cancelGraceTimer|hasPendingGraceTimer)\(` in `src/` returns exactly one match — the trio's own internal self-call at `:141`. No production caller depends on the userId-keyed methods.
- **No spec references remain.** Grep over `src/**/*.spec.ts` for the three methods returns zero matches, confirming note 41 already retired the store-spec cases. Task 2's claim holds.
- **Shared state correctly preserved.** The `timers` map (`:16`) and `graceMs` field (`:17`) are read/written by the live `*ForSession` family. The plan explicitly instructs leaving them untouched, which is correct — deleting them would break production.

## Findings

None. The plan is a clean, scoped, behavior-preserving dead-code removal.

- Tasks are correctly ordered with an explicit dependency (Task 2 depends on Task 1).
- The verification grep in Task 2 (`| grep -v ForSession`) is the right gate and will correctly return zero matches after the self-call is removed.
- Build + test gates are appropriate for a no-test-added change.
- Single-commit guidance and commit message align with project conventions (no type prefix, imperative).

## Context Gates

- **Architecture:** No `.ai-factory/ARCHITECTURE.md` boundary concern — change is internal to one service, modules untouched. WARN (file not consulted; not applicable to a single-method deletion).
- **Rules:** Respects mind_api conventions — no migration involved (no schema change), Logger untouched, module boundaries intact.
- **Roadmap:** Pure cleanup; no milestone linkage required.

## Positive Notes

- Plan correctly identifies the self-call as the sole reason the trio appears "used" and pre-empts the false positive.
- Strong guardrails: explicit "do not modify `*ForSession` / `timers` / `graceMs`" note prevents the most likely mistake.

PLAN_REVIEW_PASS
