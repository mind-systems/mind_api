# Plan Review: Corrective tests — dual-mock the instruction pause suite

**Plan:** `23-corrective-tests-dual-mock-the-instruction-pause-suite.md`
**Files Reviewed:** 1 plan + spec, controller, ROADMAP, note 38
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md`): Test-only change to a single grpc controller spec. No module-boundary or dependency-graph impact. PASS.
- **Rules** (`.ai-factory/RULES.md`): No production code, no logging, no migrations touched — none of the enforced conventions apply. PASS.
- **Roadmap** (`.ai-factory/ROADMAP.md`): Directly traces to the open task at line 74 ("Corrective tests: dual-mock the instruction pause suite") and its spec `notes/38-test-instruction-pause-dual-mock.md`. Linkage is explicit and correct. PASS.

## Verification of Plan Assumptions (all confirmed against source)

- **Controller currently resolves via `getActiveSession(userId)`** — confirmed at `module-instruction-stream.grpc.controller.ts:78`. The a3 swap to `getSession(userId, sessionId)` is described in ROADMAP line 96 / note 36, so the false-RED risk the plan guards against is real.
- **Three pushing pause cases seed only `getActiveSession`** — confirmed at spec `:115`, `:137`, `:161`, inside `describe('streamData — pause pass-through')` (`:112`).
- **Ready-frame case (`:183`, seed `:185`) pushes no sample** — confirmed: it only subscribes and asserts the synchronous `ready` frame (`:189-204`), never emits a `StreamSample`, so it never hits the resolver. Correctly excluded.
- **`makeActivityEngine()` already exposes both methods** — confirmed at `:42-47` (`getActiveSession` and `getSession`, both defaulting to `undefined`). No factory edit needed, as the plan states.
- **Ownership target cases own `getSession`** — confirmed at `:247-338`; correctly flagged as out of scope (RED until note 36 lands the controller swap).
- **Line numbers in the plan match the file exactly** — `:113/:115`, `:135/:137`, `:159/:161`, `:183/:185`, `:247-`, `:42-47` all verified.

## Correctness Notes

- The dual-seed (`getSession.mockReturnValue(paused)`) is harmless under the **current** controller (which never calls `getSession`), so characterization stays GREEN today; and it makes the cases survive the a3 swap. The invariant ("pause never blocks ingest") is preserved both before and after — exactly the two-state guarantee a characterization fix needs.
- `mockReturnValue(paused)` vs `mockImplementation((_u, sid) => ...)`: the plan uses the simpler `mockReturnValue`. This is sufficient because each case uses a single `sessionId` and the paused fixture's `sessionId` matches `msg.sessionId`, so any future `session.sessionId !== msg.sessionId` echo guard would still pass. Note 38 (`:34`) explicitly sanctions either form. No issue.
- Behavioral assertions are left untouched per the plan, preserving the characterization contract (no new target introduced).

## Scope / Process

- No migration involved (test-only). Correctly omits one.
- No security surface.
- File path `src/realtime/module-instruction-stream.grpc.controller.spec.ts` is correct.
- Task 2's note that the ownership cases (`:247-`) remain RED until note 36 is accurate and the right expectation to set.

## Positive Notes

- Tightly scoped: exactly three seeds, with explicit "do not touch" fencing for the factory, the ready-frame case, and the ownership cases — eliminates collateral edits.
- Plan faithfully mirrors note 38, including the rationale for why the fourth pause case is excluded.
- Aligns cleanly with the test-epic contract in ROADMAP (characterization must stay GREEN, named by file:line).

No missing steps, wrong assumptions, architectural mistakes, missing migrations, security issues, or incorrect paths/API usage found.

PLAN_REVIEW_PASS
