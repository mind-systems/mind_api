## Plan Review Summary

**Plan:** Resolve the target by ownership, not sole-child
**Files Reviewed:** 4 (controller, controller spec, activity-engine, activity-session-store)
**Risk Level:** 🟢 Low

### Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md`): PASS. The change keeps the controller thin (delegates to a service accessor), adds the new public method on `ActivityEngine` rather than reaching into the store from the controller, and respects module boundaries. No new cross-module imports. Aligned with the "controllers are thin / services own logic" principle.
- **Rules** (`.ai-factory/RULES.md`): PASS.
  - No non-null assertion (`!`) introduced in the proposed snippets.
  - No sensitive data logged; no new logging added (Settings: logging minimal — honored).
  - The gRPC method already uses `@Payload()` + `@GrpcCurrentUser()` correctly; the plan does not touch the signature.
- **Roadmap** (`.ai-factory/ROADMAP.md`): Not found at the reviewed path. WARN (non-blocking): no roadmap linkage available for this `refactor`-class work. No action required.

### Verification Against Codebase

Every concrete claim in the plan was checked against the actual source:

- ✅ `ActivitySessionStore.getSession(userId, sessionId)` exists exactly at `activity-session-store.service.ts:108-113` and performs the child-or-root resolution the plan relies on.
- ✅ `ActivityEngine` accessors live at `:533-549` (`getActiveSession`, `getSoleChild`, `getRootId`, `listLiveSessions`). There is **no** existing public `getSession` on the engine, so Task 1 adds new surface without collision.
- ✅ `ActivityState` is already imported in `activity-engine.service.ts:7`, so the new method's return type needs no new import.
- ✅ `getActiveSession`/`getSoleChild` are still referenced elsewhere in the engine (`:556`, `:173`, etc.) and by the spec mock — the plan's instruction to leave them intact is correct.
- ✅ Controller line ranges all match: hygiene guard `:67-76`, `NO_SESSION` guard `:78-89`, `SESSION_MISMATCH` guard `:91-100`, `push` call `:102-107`, ack `:109-117`, buffer-cap warn `:119-123`, `INTERNAL_ERROR` catch `:124-136`. Removals/keeps described in Task 2 land precisely on these blocks.
- ✅ The controller emits **literal** error-code strings today (`'INVALID_ARGUMENT'`, `'NO_SESSION'`, `'SESSION_MISMATCH'`, `'INTERNAL_ERROR'`) and does **not** import `WsErrorCode`. The plan's "emit literal `'SESSION_NOT_FOUND'`" instruction is consistent with the existing convention — no need to wire in the constants file.
- ✅ The spec already exposes both mocks (`getActiveSession` at spec `:44`, `getSession` at `:45`) and the pause pass-through suite dual-seeds `getSession` (`:117/:139/:163`). The ownership-routing suite (`:247-338`) drives `getSession` and asserts literal `'SESSION_NOT_FOUND'` (`:333`). The proposed controller change makes all of these green without touching test files — matching the plan's "do not edit test files" constraint.

### Critical Issues

None. No missing migration (in-memory store only — correctly stated as "no migration"), no proto change (correctly stated), no security regression (ownership check is strictly *tighter* per-sample than before: it now validates the supplied `sessionId` against the user's own live sessions rather than only the sole active child).

### Observations (non-blocking)

- The retired codes `NO_SESSION` / `SESSION_MISMATCH` remain in `constants/ws-error-codes.ts`. After this change the instruction controller no longer emits them, but they may still be referenced by the biometric controller/spec, so the plan is right not to remove them here. Cleanup of dead error-code constants is a separate concern.
- `SESSION_NOT_FOUND` is introduced as a literal not present in `WsErrorCode`. Consistent with current controller style; if the team later standardizes on the constants map, this is the place to add it. Out of scope for this milestone.
- Spec test `:183` ("ready frame even when paused") only seeds `getActiveSession`, but it asserts only on the synchronous `ready` frame and does not depend on session resolution, so the controller swap does not break it. Confirmed safe.

### Positive Notes

- Scope is tightly bounded and the single-commit framing fits the user's "no body for single-concern commits" preference.
- The plan explicitly preserves pause pass-through semantics (no `SESSION_PAUSED` branch), which the committed pause regression suite depends on — a subtle invariant correctly identified.
- Line-accurate references throughout; the implementing agent has no guesswork to do.

PLAN_REVIEW_PASS
