# Remove the dead userId-keyed grace-timer trio

**Date:** 2026-06-29
**Source:** conversation context (completed-work audit, cleanup)

Code cleanup task — **behavior-preserving** (deletes dead code). **Depends on [[41-retire-store-spec-userid-grace-cases]]** — that test task must land first so the store suite has no cases referencing the removed methods.

## Problem today
`ActivitySessionStore` (`src/realtime/services/activity-session-store.service.ts`) exposes a **userId-keyed** grace-timer trio that production no longer uses:
- `startGraceTimer(userId, onExpiry)` (`:140-147`)
- `cancelGraceTimer(userId)` (`:149-154`)
- `hasPendingGraceTimer(userId)` (`:156-158`)

Production keys grace timers by **sessionId** via the parallel trio `startGraceTimerForSession` / `cancelGraceTimerForSession` / `hasPendingGraceTimerForSession` (`:162-183`). The multi-session store/engine refactor ([[03-multi-session-store-engine]]) moved all timers to sessionId keys.

**Confirmed no external caller:** `grep -rn --include='*.ts' -E '\.(startGraceTimer|cancelGraceTimer|hasPendingGraceTimer)\(' src/ | grep -v ForSession | grep -v .spec.ts` → the **only** match is `activity-session-store.service.ts:141` (`this.cancelGraceTimer(userId)` inside `startGraceTimer` itself — a self-reference within the dead trio). No production code path reads the userId-keyed methods.

## The change
- Delete the three methods `startGraceTimer` / `cancelGraceTimer` / `hasPendingGraceTimer` (`:140-158`). Their internal self-call (`:141`) goes with them.
- Leave the sessionId-keyed trio (`:162-183`) and the shared `this.timers` map + `this.graceMs` untouched — `*ForSession` reads/writes the same `timers` map and is the live mechanism.

## Verify before deleting
- Re-run the prod-caller grep above → only the self-reference at `:141` remains (which is deleted with the trio). No controller/engine/watchdog references a userId-keyed grace method.
- `npm run build` clean; full suite green (note 41 has already retired/rewritten the store spec cases).

## Guards / gotchas
- Sequencing is the only risk: deleting these before note 41 retires the spec cases would red the store suite. Order in the roadmap is 41 (test) above 42 (code).
- Do not touch `startGraceTimerForSession`/`cancelGraceTimerForSession`/`hasPendingGraceTimerForSession` or the `timers`/`graceMs` fields.

## Anti-targets
None in production code. The only references were the store spec cases, retired by [[41-retire-store-spec-userid-grace-cases]] before this lands.
