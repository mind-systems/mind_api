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

_(Recorded during test-writing pass for `02-tests-multi-session-lifecycle-state-machine`.
Flag each gap to the owning Phase 55 feature task before implementing it.)_

### [F-01] `handleTransportDisconnect` moves only one session (→ `03-multi-session-store-engine`)

**Current code:** `handleTransportDisconnect(userId)` calls `onDisconnect(userId)` once, which resolves
`activityMap.get(userId)` — a single `ActivityState`. It then starts a single grace timer keyed to `userId`
in `timers: Map<userId, …>`.

**Gap:** When a user has a root session + N child sessions (the target multi-session model), only the
session currently stored under `userId` in the `Map<userId, ActivityState>` is disconnected and gets a
grace timer. The remaining live sessions are not touched — they stay `ACTIVE` in the DB and never get a
grace timer. If the grace fires only for one session, the others remain silently stale.

**Required contract (target test `transport disconnect moves EVERY live session`):**
`handleTransportDisconnect` must iterate over all of the user's live sessions (root + children) and:
- call `repo.update(sessionId, { status: DISCONNECTED, disconnectedAt })` for each, and
- start a per-sessionId grace timer (timer map keyed by `sessionId`, not `userId`) for each.

**Owns:** `03-multi-session-store-engine` (store fan-out + per-session timer map).

---

### [F-02] `handleReconnect` resumes only one session (→ `03-multi-session-store-engine`)

**Current code:** `handleReconnect(userId)` checks `activitySessionStore.has(userId)`, cancels a
single `userId`-keyed grace timer, and calls `resumeActivity(userId)` which resolves `get(userId)` →
one session.

**Gap:** With a root + N children, only one session (whichever is currently under the `userId` slot) is
resumed. The remaining `DISCONNECTED` sessions are never resumed and their per-session grace timers are
never cancelled — they will eventually fire and abandon those sessions silently.

**Required contract (target test `reconnect in grace resumes EVERY disconnected session`):**
`handleReconnect` must iterate over all of the user's sessions that are in the `DISCONNECTED` state and:
- cancel the per-sessionId grace timer for each, and
- call `resumeActivity` (or equivalent) to set each back to `ACTIVE`, clear `disconnectedAt`.

**Owns:** `03-multi-session-store-engine`.

---

### [F-03] `onDisconnect` never schedules a grace timer (design note, not a gap) (→ `03-multi-session-store-engine`)

`onDisconnect` intentionally only marks `DISCONNECTED` — the grace timer is started by the caller
`handleTransportDisconnect`. This delegation is correct. When Phase 55 introduces a per-session fan-out,
`handleTransportDisconnect` must be the place that iterates and starts per-session timers; `onDisconnect`
(or its successor) should remain a pure "mark disconnected" step.

---

### [F-04] Grace timer map must be re-keyed from `userId` to `sessionId` (→ `03-multi-session-store-engine`)

**Current code:** `ActivitySessionStore.timers: Map<userId, ReturnType<typeof setTimeout>>`.

**Gap:** With multiple concurrent sessions per user, `startGraceTimer(userId, cb)` overwrites the previous
timer for the same `userId`, cancelling the grace period for any earlier session. The new model requires
`timers: Map<sessionId, …>` so each session's grace countdown is independent.

**New API the store must expose:** `startGraceTimerForSession(sessionId, cb)`,
`cancelGraceTimerForSession(sessionId)`, `hasPendingGraceTimerForSession(sessionId)`.

The existing `startGraceTimer(userId, …)` / `cancelGraceTimer(userId)` / `hasPendingGraceTimer(userId)`
may be kept for backward compat during the migration or removed if all callers are updated atomically.

**Owns:** `03-multi-session-store-engine`.

---

### [F-05] Store needs per-user children map + `addChild` / `getChild` / `listChildren` / `setRoot` / `getSoleChild` (→ `03-multi-session-store-engine`)

**Current code:** `activityMap: Map<userId, ActivityState>` — one slot per user.

**Gap:** The target model needs a `Map<userId, Map<sessionId, ActivityState>>` (children map) alongside
a `Map<userId, { sessionId, state }>` root slot. Required new methods:
- `setRoot(userId, sessionId, state)` — store the root session
- `addChild(userId, sessionId, state)` — add a child session
- `getChild(userId, sessionId)` — retrieve a specific child
- `listChildren(userId)` — all children for a user
- `getSoleChild(userId)` — convenience for callers that still assume one live child (replaces `get(userId)`)

**Owns:** `03-multi-session-store-engine`.

---

### [F-06] `abandonActivity` only addresses one session (→ `03-multi-session-store-engine`)

**Current code:** `abandonActivity(userId)` calls `activitySessionStore.get(userId)` — one state — and
sets it to `ABANDONED`.

**Gap:** When a per-session grace timer fires for `sessionId`, the callback must target that specific
session, not whatever happens to be stored under `userId` at that moment. Phase 55 must change the
abandon callback signature to `abandonActivity(userId, sessionId)` (or equivalent) so the right session
is abandoned even when multiple sessions coexist.

**Owns:** `03-multi-session-store-engine`.

---

### [F-07] `handleSessionRevoked` and watchdog `abandonStale` — per-session scope unclear (→ `03-multi-session-store-engine`)

**`handleSessionRevoked` (if present):** Currently stops the single active session by userId. With
multi-session, revoke must target a specific sessionId, or stop all of the user's live sessions
(root + children). The spec does not yet define the revoke scope — clarify before implementing.

**`abandonStale(userId, sessionId)`** already takes a `sessionId` so it is closer to correct, but it
clears the store via `activitySessionStore.delete(userId)` (the per-user slot). After Phase 55,
it must remove the specific child or root entry from the children/root maps by `sessionId`.

**Owns:** `03-multi-session-store-engine`.

---

### [F-08] `ensureRoot` and `rootSessionId` linkage not defined in any existing service or entity (→ `04-lazy-root-creation`)

**Current code:** `ActivityEngine` has no `ensureRoot` method. `ModuleSession` entity has no
`rootSessionId` column. `ActivityState` interface has no `rootSessionId` field.

**Required changes (target tests `ensureRoot idempotency` + `child rootSessionId`):**
1. Add `rootSessionId: string | null` column to `ModuleSession` entity + migration.
2. Add `rootSessionId?: string` to `ActivityState` interface.
3. Implement `ActivityEngine.ensureRoot(userId)`:
   - If a root session for `userId` already exists in the store → return it (idempotent).
   - Otherwise create a new `ModuleSession` with `activityType = 'root'`, `rootSessionId = null`,
     `status = ACTIVE`, persist, store via `setRoot`, return.
4. `startActivity` must call `ensureRoot` internally (or the caller does), then set
   `session.rootSessionId = root.id` on the new child row before persisting.

**Owns:** `04-lazy-root-creation`.

---

### [F-09] `activity:end` must never target the root session (→ `04-lazy-root-creation`)

**Current code:** `endActivity(userId)` resolves `activitySessionStore.get(userId)` — whatever is
stored. If Phase 55 makes the root the primary slot under `userId`, calling `endActivity` would end
the root.

**Required contract (target test `should never end the root via activity:end`):**
`endActivity` must resolve the *addressed child* for the user, not the root. The resolution logic must
skip any session whose `activityType === 'root'`. If the sole session is a root (no child started yet),
`endActivity` should no-op or return `null`.

**Owns:** `04-lazy-root-creation`.
