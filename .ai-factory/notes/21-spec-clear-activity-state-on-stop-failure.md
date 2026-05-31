# Spec — Phase 28: clear in-memory activity state on `stopActivity` failure

**Date:** 2026-05-31
**Source:** code review note 13 §LOW (Phase 18) + research note 16
**Target:** `src/realtime/services/activity-engine.service.ts` (`stopActivity`)
**Scope:** no migration, no proto, no API change.

## Problem
`stopActivity` deletes the `activitySessionStore` entry only *after* `await repo.save(session)` succeeds. If `save` throws (the exact path that makes `handleSessionRevoked` emit `REVOKED`), the in-memory state leaks: within the grace window a fast reconnect calls `handleReconnect` → `resumeActivity` and resurrects a phantom session against a DB row that is still non-terminal. Bounded — the grace timer's `abandonActivity` guard clears it (~30s) and startup-recovery reconciles the DB on restart — but the 30s window is real.

## Fix
Wrap the body after the initial `state` / `session` lookups in `try { … } finally { this.activitySessionStore.delete(userId) }` so the entry is removed whether `repo.save` succeeds or throws.
- On success: identical to today — the `INTERRUPTED` emit still fires inside `try`.
- On failure: state is cleared instead of leaking; `handleSessionRevoked` still emits `REVOKED` from its own catch (it resolves `sessionId` before calling `stopActivity`, so that path is unaffected).
- The `findOne` not-found branch already deletes + returns null — just let the `finally` cover it; no behavior change there.
- No new public method on the engine.

## Guard
The related concern about `stats.worker` not handling `REVOKED` is intentional by design (a failed finalize has no terminal DB row to aggregate) — **do not** add a stats handler.
