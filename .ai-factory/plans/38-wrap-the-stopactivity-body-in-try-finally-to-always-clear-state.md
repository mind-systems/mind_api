# Plan: Wrap the `stopActivity` body in `try/finally` to always clear state

## Context
Guarantee that `ActivityEngine.stopActivity` always removes the in-memory `activitySessionStore` entry — even when `repo.save` throws — so a fast reconnect within the grace window cannot resurrect a phantom session. Happy path is unchanged.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Harden state cleanup

- [x] **Task 1: Wrap `stopActivity` post-lookup body in `try/finally`**
  Files: `src/realtime/services/activity-engine.service.ts`
  In `stopActivity` (currently lines 197-246), keep the two early guard branches at the top unchanged:
  - the `if (!state)` warn + `return null` (no store entry yet — nothing to clear);
  - the `findOne` not-found branch — leave its explicit `this.activitySessionStore.delete(userId)` + `return null` as is (it already clears state; the `finally` deleting an already-absent key is a harmless no-op).
  Wrap everything from `session.status = SessionStatus.INTERRUPTED` through the final `return saved` in a `try { … }` block, and move the existing `this.activitySessionStore.delete(userId)` call (line 228) out of the body into a `finally { this.activitySessionStore.delete(userId); }` block at the end of that `try`.
  Result:
  - On success — behavior identical to today: `repo.save` succeeds, the `INTERRUPTED` stream push and `SessionEvents.INTERRUPTED` emit still fire inside `try`, the log line still runs, `saved` is returned, and `finally` clears the entry.
  - On `repo.save` failure — the error still propagates to the caller (`handleSessionRevoked` in `module-state.grpc.controller.ts`, which already emits `REVOKED` from its own catch and resolves `sessionId` before calling `stopActivity`, so that path is unaffected), but `finally` now clears the leaked in-memory entry first.
  Do NOT add a `REVOKED` stats handler anywhere — a failed finalize has no terminal DB row to aggregate; this omission is intentional by design.
