# Plan Review: Tests — instruction ingest ownership for N sessions

**Plan:** `21-tests-instruction-ingest-ownership-for-n-sessions.md`
**Files Reviewed:** plan + 4 source files (controller, spec, ActivityEngine, ActivitySessionStore) + notes 33 & 36
**Risk Level:** 🟡 Medium — one blocking contradiction in the plan's own RED/GREEN success criteria; everything else is accurate.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** PASS. Test-only milestone, no module-boundary changes, no new providers. Controller-stays-thin and resolver-via-engine conventions are respected.
- **Rules (`.ai-factory/RULES.md`):** PASS. No `!` assertions introduced; one minor caveat — feeding `sessionId: undefined` (Task 4) requires an `as any` cast because the proto type is `string` (see Minor #2). Casting in a test is not a rules violation.
- **Roadmap (`.ai-factory/ROADMAP.md`):** present; this milestone is the "test authoring" half of the F3/note-36 pair, consistent with the established `tests-*` cadence (milestones 02–06, 19, 20). Linkage OK.
- **Skill-context (`.ai-factory/skill-context/aif-review/SKILL.md`):** ABSENT — no project-specific review overrides to apply.

## Verified Assumptions (all correct)

- `ActivityEngine` today exposes `getActiveSession`/`getSoleChild`/`listLiveSessions` but **not** `getSession` (`activity-engine.service.ts:533-545`). Confirmed — Task 1's premise holds.
- `ActivitySessionStore.getSession(userId, sessionId)` already resolves **child-or-root** (`activity-session-store.service.ts:108-113`), exactly as note 36's planned engine delegate describes. Confirmed.
- Controller currently calls `getActiveSession(userId)` (`:78`), emits `NO_SESSION` (`:80-89`) and `SESSION_MISMATCH` (`:91-100`), and the missing-`sessionId` → `INVALID_ARGUMENT` guard (`:67-76`) is already implemented and loud. Confirmed — Task 4 is GREEN-now as claimed.
- Spec anti-target line numbers are accurate: `makeActivityEngine()` at `:42-46`, pause-suite `getActiveSession.mockReturnValue(...)` at `:114`, `:136`, `:159`. Confirmed.
- No committed test asserts `NO_SESSION`/`SESSION_MISMATCH` frames — verified by reading the whole 218-line spec. The four mock-wiring lines are indeed the complete anti-target set.
- No migration, no proto change, no engine change required. Correct.

## Critical Issues

### 1. The "pause pass-through stays GREEN" claim is false under the Task-2 mock inversion (blocks the plan's own verification step)

The plan states repeatedly that the pause pass-through suite is characterization that **stays GREEN** in this commit:
- Context line 4: "…characterization cases (auth, ready, paused-but-owned, missing-sessionId) stay GREEN."
- Task 2: "These are characterization and must remain GREEN."
- Verify step (line 39): "characterization (auth, ready, **pause pass-through**, missing-arg) GREEN; the three target cases RED."

This is not achievable as planned. This milestone deliberately does **not** implement feature note 36, so after Tasks 1–2 the committed controller still calls `this.activityEngine.getActiveSession(userId)` (`:78`), but `makeActivityEngine()` no longer provides `getActiveSession` — Task 1 *replaces* it with `getSession`. At runtime `this.activityEngine.getActiveSession` is `undefined`, so the per-sample handler throws `TypeError: ... is not a function`, which is caught at `:124` and emitted as an `INTERNAL_ERROR` frame. No `push`, no `ack`.

Tracing the pause suite against the current controller with the inverted mock:
- `:112` "should call streamEngine.push…" — waits for `v.ack`; ack never arrives → **timeout → RED**.
- `:134` "should respond with ack…" — first non-ready frame is the `INTERNAL_ERROR` error; `expect(v.ack).toBeDefined()` → **RED**.
- `:158` "should not emit an error frame…" — an error frame *is* emitted and the awaited ack never comes → **RED**.
- `:182` (ready frame) and `:206` (register) push no sample → **GREEN** (unaffected).

So 3 of the 5 pause-suite tests flip to RED — exactly the tests the plan promises remain GREEN. Auth, ready, and missing-arg genuinely stay GREEN (they short-circuit before reaching `getActiveSession`), so only the *pause-push* trio is mislabeled, but that trio is the substantive part of the suite.

**Why this matters:** an implementer following the plan literally will run line 39's verification, see the pause-push tests RED, and reasonably conclude either (a) they made a mistake, or (b) they must implement feature 36 to make them GREEN — which the plan forbids (line 38). The plan's acceptance gate is self-contradictory.

**Resolution — pick one, and update line 4 / Task 2 / line 39 to match:**

- **Option A (recommended — keep the suite genuinely GREEN, defer inversion to feature 36).** In Task 1, have `makeActivityEngine()` expose **both** methods:
  ```js
  function makeActivityEngine() {
    return {
      getActiveSession: jest.fn().mockReturnValue(undefined),
      getSession: jest.fn(),
    };
  }
  ```
  Leave the three pause lines (`:114/:136/:159`) wired to `getActiveSession` **untouched** in this commit. The pause suite then stays truly GREEN now, and the mock inversion of those three lines moves into feature 36's commit (alongside the controller swap that makes it correct). Drop Task 2 from this milestone, or rescope it to "leave pause wiring intact; only add `getSession` to the factory." This is the cleanest TDD story: a test stays green until the behavior it pins actually changes.

- **Option B (keep the inversion, tell the truth about it).** Accept that inverting `:114/:136/:159` to `getSession` makes the pause-push trio **RED-until-36**, and reclassify it: this commit is RED for both the target cases *and* the pause-push trio; feature 36 turns all of them GREEN together. Update line 4, Task 2, and the line-39 verification so the expected state is "auth/ready/missing-arg GREEN; pause-push trio + 3 target cases RED." This keeps the plan's stated intent (invert now) but corrects the false GREEN claim.

Option A is preferable because it preserves the milestone's headline promise ("characterization stays GREEN, only targets RED") and avoids dragging genuine characterization tests into the RED set.

> Note: this defect originates in notes 33 and 36 (both assert the pause suite "stays GREEN" while prescribing the `getSession` inversion). If Option B is chosen, the notes' Red/Green contract sections are also wrong and should be corrected; if Option A, note 33's anti-target lines `:114/:136/:159` should be moved to feature 36's scope.

## Minor Issues / Nits

1. **Avoid `done()`-on-ack for the RED target cases (Task 3).** Under the current controller the two-children case never emits an ack (it throws → `INTERNAL_ERROR`), so a test that calls `done()` only inside `if (v.ack)` will hang to the jest timeout rather than fail fast. Because `request$` is a `Subject` and the controller's `next` handler runs synchronously, the implementer should collect frames into an array and assert **synchronously after** `request$.next(...)` (on the `push` spy and the first non-`ready` frame). The plan gestures at this ("fails cleanly rather than hanging") — make it explicit so the implementer doesn't reach for `done()`.

2. **`sessionId: undefined` needs a cast (Task 4).** `StreamSample.sessionId` is typed `string`, and `makeBreathPhaseSample(sessionId: string)` takes a string. Pushing `undefined` requires `makeBreathPhaseSample(undefined as any)` or building the sample inline with `as any`. The `''` case needs no cast and already exercises the same `if (!msg.sessionId)` guard, so `''` alone is sufficient for the GREEN smoke check; `undefined` is optional.

3. **`makePausedSession` for non-paused target states is fine.** Task 3 reuses `makePausedSession` (which sets `isPaused: true`) for the owned-child/root states. The ingest path never reads `isPaused`, so truthiness is all that matters — acceptable, and consistent with note 33. No action needed; just confirming it isn't a latent bug.

## Positive Notes

- Anti-target enumeration is exact and was cross-checked against the live spec — no phantom lines, no missed `getActiveSession` references.
- Correctly identifies that `streamEngine.push` is `sessionId`-keyed (`:102`), so per-child/root buffering is automatic and the targets assert on call args, not buffer internals — no over-reach.
- Correctly scopes out migration/proto/engine changes; this is purely test authoring.
- The RED-on-purpose discipline (no `skip`/`xit`, single commit) matches the repo's established `tests-*` milestone pattern.
- `getSession` child-or-root semantics in the store were independently verified against `endActivity`'s existing usage (`activity-engine.service.ts:181`), confirming note 36's delegate plan is sound.

## Verdict

The plan is well-researched and almost entirely accurate, but Critical Issue #1 makes its stated acceptance criteria (line 39) impossible to satisfy as written — the pause pass-through suite cannot stay GREEN in this commit while its mocks are inverted to `getSession` and the controller is left on `getActiveSession`. Resolve via Option A or B and correct the RED/GREEN labeling before implementation.
