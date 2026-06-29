# Plan Review 2: Tests — instruction ingest ownership for N sessions

**Plan:** `21-tests-instruction-ingest-ownership-for-n-sessions.md`
**Files Reviewed:** plan + controller, spec, ActivityEngine, note 36, plan-review-1
**Risk Level:** 🟢 Low — the blocking contradiction from plan-review-1 is fully resolved (Option A); all minor nits folded in.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** PASS. Test-only milestone. No module-boundary changes, no new providers, no controller logic change. "Controller stays thin" and "resolver via engine" conventions untouched.
- **Rules (`.ai-factory/RULES.md`):** PASS. No `!` non-null assertions introduced. Task 3 explicitly avoids the `as any` cast by using `sessionId: ''` (and flags the cast only for the optional `undefined` variant). Compliant.
- **Roadmap (`.ai-factory/ROADMAP.md`):** Present. This is the test-authoring half of the F3 / note-36 pair, matching the established `tests-*` cadence (02–06, 19, 20). Linkage OK.
- **Skill-context (`.ai-factory/skill-context/aif-review/SKILL.md`):** ABSENT (confirmed) — no project-specific review overrides to apply.

## Resolution of plan-review-1's Critical Issue (verified)

Plan-review-1's only blocker was the self-contradictory RED/GREEN gate: inverting the pause-suite mocks (`:114/:136/:159`) to `getSession` while leaving the controller on `getActiveSession` would throw `TypeError` → `INTERNAL_ERROR` and flip the pause-push trio RED, contradicting the "pause stays GREEN" promise.

The revised plan adopts **Option A** correctly and completely:

- **Task 1** now exposes *both* `getActiveSession` (kept, default `undefined`) and `getSession` (added) in `makeActivityEngine()` — verified against the actual factory at `spec :42-46`. This matches the recommended snippet exactly.
- The plan now states **three times** (Context line 6, Task 1 closing line, Notes) that the pause-suite lines `:114/:136/:159` must **not** be inverted in this commit — the inversion is explicitly deferred to feature 36's commit. This is consistent with plan-review-1's closing note ("If Option A, note 33's anti-target lines should be moved to feature 36's scope").
- The verify step (Notes, line 48) now reads "auth, ready, pause-push trio, register, and missing-arg GREEN; the three ownership target cases RED" — the false GREEN claim is gone.

I traced this against the live controller and confirmed the new contract holds:
- Pause-push trio (`:112/:134/:158`) still calls `getActiveSession` (kept in factory, returns the paused session via the unchanged mock lines) → push + ack → **GREEN**. ✓
- Three target cases configure `getSession`, but the controller still calls `getActiveSession` (default `undefined`) → `NO_SESSION` frame, no push, no ack → each target's assertion (`push` called / `SESSION_NOT_FOUND` code / two acks) fails synchronously → **RED**. ✓
- Missing-`sessionId` (`''`) short-circuits at the `:67-76` guard → `INVALID_ARGUMENT`, no push → **GREEN**. ✓

## Minor nits from plan-review-1 (all folded in)

1. **Avoid `done()`-on-ack for RED cases** → Task 2 now spells out the synchronous-assertion approach explicitly: collect frames into an array, push, assert immediately on the `push` spy and collected frames, skip the leading `ready` frame, no `done()`. This guarantees the RED cases fail fast rather than timing out. ✓
2. **`sessionId: undefined` cast** → Task 3 uses `''` (no cast needed) for the GREEN smoke check and marks the `undefined` variant optional, noting it would need `makeBreathPhaseSample(undefined as any)`. ✓
3. **`makePausedSession` reuse for owned states** → Task 2's parenthetical confirms the ingest path never reads `isPaused`, only truthiness matters. ✓

## Verified Assumptions

- `ActivityEngine` exposes `getActiveSession`/`getSoleChild`/`listLiveSessions` but **not** `getSession` (`activity-engine.service.ts:533-545`) — re-confirmed by direct read. Task 1's premise holds.
- Controller still calls `getActiveSession(userId)` (`:78`) and emits `NO_SESSION`/`SESSION_MISMATCH`; the missing-`sessionId` → `INVALID_ARGUMENT` guard (`:67-76`) is implemented and loud. The RED/GREEN split is exactly as the plan claims.
- Spec line references are accurate: `makeActivityEngine()` `:42-46`, pause-suite mock lines `:114/:136/:159`, register test `:206`.
- `streamEngine.push` is `sessionId`-keyed (`:102`), so per-child/root buffering is automatic — the target cases correctly assert on call args, not buffer internals.
- No migration, proto, or engine change required. Correct — purely test authoring.

## Critical Issues

None.

## Positive Notes

- The Context section's "RED/GREEN contract (corrected per plan-review-1, Option A)" callout makes the deferral of the mock inversion to feature 36 unambiguous — an implementer cannot accidentally invert `:114/:136/:159`.
- Task 2 correctly anticipates the post-36 GREEN behavior (truthy `getSession` → two pushes/acks) while ensuring the case is RED-but-fast today.
- RED-on-purpose discipline preserved: no `skip`/`xit`, single commit, matching the repo's `tests-*` cadence.
- The note about retired `NO_SESSION`/`SESSION_MISMATCH` codes having no committed test correctly scopes out any phantom inversion work.

## Verdict

The plan fully resolves plan-review-1's blocker and absorbs all three minor nits. The RED/GREEN contract is now internally consistent and matches the live controller and spec. Ready to implement.

PLAN_REVIEW_PASS
