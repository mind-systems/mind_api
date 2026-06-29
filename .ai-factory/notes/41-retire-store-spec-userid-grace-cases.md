# Retire the store spec's userId-keyed grace-timer cases

**Date:** 2026-06-29
**Source:** conversation context (completed-work audit, test cleanup)

Test-only cleanup task. A **new task** editing a committed spec from a frozen `[x]` task. **Unblocks [[42-remove-userid-keyed-grace-trio]]** (the code deletion) — must land **before** it so the suite has no orphaned cases when the methods are removed.

## Problem today
`ActivitySessionStore` carries a dead **userId-keyed** grace-timer trio — `startGraceTimer(userId, …)` / `cancelGraceTimer(userId)` / `hasPendingGraceTimer(userId)` (`activity-session-store.service.ts:140-159`). Production keys timers by **sessionId** (`startGraceTimerForSession` / `cancelGraceTimerForSession` / `hasPendingGraceTimerForSession`, `:162-183`); the only caller of a userId-keyed method is the trio's own internal `this.cancelGraceTimer(userId)` self-call (`:141`). But `src/realtime/services/activity-session-store.service.spec.ts` still exercises the userId-keyed trio across many cases:
- `constructor` block — `:44`, `:56` (`startGraceTimer('user-1', cb)`), `:79` (`hasPendingGraceTimer('any-user')`).
- `set()` / `delete()` blocks — `:133/:136`, `:165/:168`, `:177/:181` (assert timers are independent of state mutation, via `startGraceTimer`/`hasPendingGraceTimer`).
- `describe('startGraceTimer() — happy path firing')` (`:226+`), `describe('startGraceTimer() — replacing an existing timer for the same userId')` (`:257+`), and the post-expiry-cleanup block (`Phase 8`, `:288+`).

## The change (test-only)
- Remove the userId-keyed grace-timer cases: the `startGraceTimer()` happy-path / replacing / post-expiry describes, and the constructor cases that assert grace behavior **through** `startGraceTimer`/`hasPendingGraceTimer`.
- The `set()`/`delete()` cases that use a grace timer only to prove "state mutation does not touch timers" should be **rewritten** to the sessionId-keyed mechanism (`startGraceTimerForSession`/`hasPendingGraceTimerForSession`) so the invariant they guard survives, rather than deleted — unless that invariant is already covered by a sessionId-keyed case (confirm before dropping).
- The default/custom grace-period constructor assertions (`WS_RECONNECT_GRACE_MS`, default 30000ms) must be preserved — re-express them through `startGraceTimerForSession` if they currently fire via `startGraceTimer` (the `graceMs` field is shared by both timer APIs).

## Verify
- After the edit, `grep -nE '\.(startGraceTimer|cancelGraceTimer|hasPendingGraceTimer)\(' src/realtime/services/activity-session-store.service.spec.ts | grep -v ForSession` → **zero** matches.
- `npx jest src/realtime/services/activity-session-store.service.spec.ts` green; the sessionId-keyed timer coverage and the grace-period config assertions remain.

## Guards / gotchas
- Do **not** weaken unrelated store cases (`get`/`has`/`set`/`delete`/`size`, root/child accessors). Scope is exactly the userId-keyed grace-timer cases.
- Land this **before** [[42-remove-userid-keyed-grace-trio]] — deleting the methods first would red the suite.

## Anti-targets
The userId-keyed grace cases are the anti-targets: they pin a dead mechanism. Retire/rewrite them; nothing to invert toward a new behavior.
