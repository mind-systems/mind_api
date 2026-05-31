# Code Review: Wrap `stopActivity` body in `try/finally` to always clear state

**Scope reviewed:** `src/realtime/services/activity-engine.service.ts` (`stopActivity`)
**Diff:** `git diff HEAD`

## Summary

The change wraps the post-lookup body of `stopActivity` in `try { … } finally { this.activitySessionStore.delete(userId) }`, moving the single `delete` call out of the happy path and into `finally`. This guarantees the in-memory store entry is cleared whether `repo.save` succeeds or throws, closing the ~30s phantom-resume window described in the spec.

## Correctness analysis

- **Matches spec and plan exactly.** Both early guard branches are left unchanged: the `if (!state)` branch returns before any store entry concern, and the `findOne` not-found branch still explicitly deletes + returns *before* entering the `try` (so `finally` never runs there — no double-delete, no behavior change).
- **Happy path unchanged.** On success `repo.save` resolves, the `INTERRUPTED` stream push, the log line, and the `SessionEvents.INTERRUPTED` emit all still fire inside `try`. `return saved` evaluates `saved` before `finally` runs; `finally` performs only a side-effecting `delete` and does not contain a `return`, so it cannot override or swallow the returned value. Behavior is identical to before.
- **Failure path fixed.** If `repo.save` (or the synchronous `streamEngine.push`) throws, `finally` clears the leaked entry and the error still propagates to the caller. No swallowing — `finally` neither returns nor catches.
- **Caller REVOKED path unaffected (verified).** In `module-state.grpc.controller.ts:184-195`, `handleSessionRevoked` resolves `sessionId` via `getActiveSession(...)` *before* calling `stopActivity`, then emits `SessionEvents.REVOKED` from its own `catch`. Clearing the store inside `stopActivity`'s `finally` happens after that capture, so the REVOKED emit still has its `sessionId`. The propagated error is caught and handled as before.
- **Variable scope intact.** `now` and `state` are declared before the `try` and remain in scope inside it; no shadowing or TDZ issues.
- **Stats handler guard respected.** No `REVOKED` stats handler was added, as required by the spec.

## Runtime / edge cases

- No migration, proto, or API surface change — none required.
- No new async ordering hazards: `finally` runs synchronously after the awaited body settles.
- Minor incidental hardening: if `streamEngine.push` or `eventEmitter.emit` were to throw synchronously, state is now also cleared (previously it would have leaked). This is within scope and strictly beneficial.

No bugs, security issues, or correctness problems found.

REVIEW_PASS
