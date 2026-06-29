## Plan Review Summary

**Plan:** Drop the dead `getActiveSession` mock from the instruction spec
**Files Reviewed:** 3 (plan, target spec, target controller) + cross-check of realtime suite
**Risk Level:** 🟢 Low

### Context Gates
- **Architecture:** No `.ai-factory/ARCHITECTURE.md` present at the API level for this change — not required for a test-only cleanup. No boundary impact: change is confined to one spec file.
- **Rules:** CLAUDE.md mandates migrations for schema changes and CLI-generated timestamps — neither applies; this is test-only with no production or DB changes. No rule violations.
- **Roadmap:** This is a `test`/`chore`-class cleanup (dead mock removal). No roadmap milestone linkage expected. WARN-level only, non-blocking.

### Verification Against Codebase

Every factual claim in the plan was checked against the actual files:

- **Controller path verified.** `module-instruction-stream.grpc.controller.ts:78` calls `this.activityEngine.getSession(userId, msg.sessionId)` — keyed by `(userId, sessionId)`, exactly as the plan states. The controller never calls `getActiveSession`. The a3 routing premise is correct.
- **Line 44 (dead mock):** confirmed — `getActiveSession: jest.fn().mockReturnValue(undefined)`. Removing it leaves `getSession` (line 45) as the sole factory member, which the controller and ownership suite use. ✅
- **Lines 116, 138, 162 (Task 2):** confirmed — each is a `getActiveSession.mockReturnValue(paused)` immediately followed by a `getSession.mockReturnValue(paused)` seed (117, 139, 163). Deleting the former while keeping the latter is correct: the controller resolves the paused session via `getSession`. ✅
- **Line 185 (Task 3):** confirmed — the "should still emit ready frame on connection even when session is paused" case (lines 183–205) pushes **no** sample (`request$.next` is never called) and asserts only the synchronous ready frame. The session-resolution path is never reached, so removing the seed with no replacement is correct. ✅

### Scope Check (no collateral damage)

`getActiveSession` is a **real production method** (`activity-engine.service.ts:533`) used by other specs — `concurrency-idempotency.spec.ts`, `module-state.grpc.controller.spec.ts`, and `activity-engine.service.spec.ts`. The plan correctly scopes all edits to `module-instruction-stream.grpc.controller.spec.ts` only and does **not** touch the production method or the other consumers. Task 4's grep is correctly narrowed to the two controller files (`.ts,.spec.ts`), so it won't false-positive on the unrelated specs. No risk of breaking the broader realtime suite.

### Minor Notes (non-blocking)
- After Task 1, the comment on line 45 (`// added — used by the new ownership target cases`) becomes the only factory comment; it remains accurate. The stale-reference comment is the one being deleted (line 44), so no orphaned comment is left behind. No action needed.
- The plan's "Settings: Testing: no" is appropriate — the work *is* the test, and Task 4 already runs `npx jest` on the file as verification.

### Positive Notes
- Line-accurate: every cited line number matches the current file state.
- Correctly distinguishes the push cases (keep `getSession` seed) from the no-push ready-frame case (no seed needed) — the subtle part of this cleanup, handled right.
- Verification task is concrete and falsifiable (grep → zero matches, then run the suite).

No missing steps, wrong assumptions, architectural mistakes, missing migrations, security issues, or incorrect paths found.

PLAN_REVIEW_PASS
