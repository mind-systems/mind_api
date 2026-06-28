# Test plan — multi-session lifecycle state machine (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature tasks [[03-multi-session-store-engine]] + [[04-lazy-root-creation]].

## Why this area (silent-failure filter)
The store/engine is a state machine. Wrong transitions fail **silently**: a session left `active` after disconnect, a grace timer keyed to the wrong id, a reconnect that resumes only one of several disconnected sessions, a child created without a `rootSessionId`. None throw — they produce wrong rows and wrong stats later. Highest-value area in the refactor.

## Behavior under change — think hard before writing
Before writing assertions, diff the new per-session model against the current `Map<userId, ActivityState>` code path by path. For every place the old code assumed "one session per user" (grace timer, disconnect, resume, revoke, watchdog `abandonStale`), ask: *what does the new code do when the user has a root + N children?* If the feature spec ([[03-multi-session-store-engine]]/[[04-lazy-root-creation]]) does not answer a case (e.g. "disconnect must move ALL of the user's live sessions to `disconnected`, each with its own grace timer"), record it under **Findings** and flag the feature task before it is implemented — a gap found here is a gap in the feature.

## Red/Green contract
- **Characterization (GREEN now, must stay GREEN through [[03-multi-session-store-engine]]):** all current single-session flows — start→end, start→stop, disconnect→grace→abandon, disconnect→reconnect-in-grace→resume, pause/resume. [[03-multi-session-store-engine]] is declared behavior-preserving, so a RED here after the refactor is a regression = Class B silent bug → escalate, do not patch the test.
- **Target (RED until [[04-lazy-root-creation]]):** root is created on connect with `activityType='root'`, `rootSessionId=null`; a started child gets `rootSessionId = root.id`; `ensureRoot` is idempotent (no duplicate root on second call / reconnect). Do not implement root creation inside the test task; red-for-the-right-reason is the done state.

## Instantiation
NestJS Testing module (or direct `new`) for `ActivitySessionStore` (needs `ConfigService` for `WS_RECONNECT_GRACE_MS`) and `ActivityEngine` (mock `Repository<ModuleSession>`, `EventEmitter2`, `StreamEngine`). Use **fake timers** for grace.

## Test cases
### ActivitySessionStore
- should store and retrieve multiple children under one userId — target→03
- should key grace timers by sessionId, not userId (two children expire independently) — target→03
- should preserve single-child get/set/delete semantics for existing callers — char
### ActivityEngine lifecycle
- should set status `completed` + `endedAt` and emit COMPLETED on end of the addressed child — char
- should move every live session of a user to `disconnected` on transport disconnect — target→03
- should resume every `disconnected` session of a user on reconnect in grace — target→03
- should not overwrite a session already resumed before its grace fired — char (guard exists today)
### ensureRoot / linking
- should create exactly one root per connection and reuse it on repeat — target→04
- should set the new child's `rootSessionId` to the active root — target→04
- should never end the root via activity:end — target→04

## Gotchas
- Grace timer is `setTimeout`; assert with fake timers + flush, and assert teardown clears timers (no leak).
- `ActivityEngine` emits via `EventEmitter2` — spy on `emit`, assert payload `activityType`/`sessionId`.
- `coerceClientTs` accepts number/Long/string — cover the Long `.toNumber()` branch.

## Findings
_(fill during test-writing; escalate to the feature task before implementing it)_
