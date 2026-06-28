# State controller: concurrent activities + idempotency dedup + session_id routing

**Date:** 2026-06-28
**Source:** conversation context

## Decisions (locked)
- Idempotency dedup window = **10_000 ms**, config key `WS_IDEMPOTENCY_WINDOW_MS` (default `10_000`) added to `src/realtime/constants/realtime-config.ts`. The `(userId, client_activity_id) → sessionId` map evicts entries past this TTL and on stream teardown.

## Key Findings

- This is where concurrent activities become *usable*: the controller drops the singleton "existing → return" guard, routes pause/resume/end/stop to the child named by `cmd.session_id`, and replaces the old implicit dedup (one-session-per-user) with explicit `client_activity_id` idempotency.
- Depends on the multi-session engine ([[03-multi-session-store-engine]]), lazy root ([[04-lazy-root-creation]]), and the proto fields ([[05-proto-session-id-idempotency]]). Breadcrumbs only — the concrete contracts this note's code touches are inlined below; the implementing agent needs nothing but this note + the codebase.

### Inlined contracts (from upstream tasks — concrete, do not open the other notes)

**Engine signatures (multi-session — sessionId-optional mutators + resolvers).** `ActivityEngine` (`src/realtime/services/activity-engine.service.ts`) exposes after task 03:
- `startActivity(userId: string, opts: { activityType: InternalActivityType; activityRefId?: string; clientTimestampMs?: number }): Promise<{ id: string }>` — unchanged signature; creates a new child (no singleton guard).
- `endActivity(userId: string, sessionId?: string, clientTimestampMs?: number): Promise<{ id: string } | null>` — **arg order is `(userId, sessionId, clientTimestampMs)`**.
- `stopActivity(userId: string, sessionId?: string): Promise<{ id: string } | null>`
- `pauseActivity(userId: string, sessionId?: string): ActivityState` — throws `Error('no_active_session')` / `Error('already_paused')`.
- `unpauseActivity(userId: string, sessionId?: string): ActivityState` — throws `Error('no_active_session')` / `Error('not_paused')`.
- `getSoleChild(userId: string): ActivityState | undefined` — returns the single live **child** (root excluded); `undefined` when 0 or >1 children. Use ONLY for the sole-child fallback; do NOT use "undefined ⇒ ambiguous" (that conflates 0 with >1).
- `listLiveSessions(userId: string): ActivityState[]` — every live session for the user (root + children). Ambiguity = `listLiveSessions(userId).filter(children).length > 1`; revoke fan-out iterates this.
- `ActivityState` shape used here: `{ sessionId: string; isPaused: boolean; activityType: string }`.

**Proto fields (ts-proto camelCase, from task 05).** On the parsed oneof commands:
- `ActivityStartCmd.clientActivityId?: string` (proto `client_activity_id = 5`) — idempotency token.
- `ActivityEndCmd.sessionId?: string` (proto `session_id = 2`), plus existing `clientTimestampMs?: number`.
- `ActivityStopCmd.sessionId?: string`, `ActivityPauseCmd.sessionId?: string`, `ActivityResumeCmd.sessionId?: string` (each proto `session_id = 1`).
All are `optional` → `field?: string`; absent on old clients.

## Details

### Current state — `src/realtime/module-state.grpc.controller.ts` (verified line numbers)
- `handleActivityStart` (lines 260-320): rate-limit (`rateLimiterService.consume('activity-start:${userId}', …)`, lines 265-279), then the singleton guard at **lines 281-290**:
  ```ts
  const existing = this.activityEngine.getActiveSession(userId);
  if (existing) {
    subscriber.next({
      sessionState: {
        moduleSessionId: existing.sessionId,
        status: ActivityStatus.ACTIVE,
      },
    });
    return;
  }
  ```
- `handleActivityEnd` (322-339) → `endActivity(userId, clientTimestampMs)`; `handleActivityStop` (341-356) → `stopActivity(userId)`; `handleActivityPause` (358-381) → `pauseActivity(userId)`; `handleActivityResume` (383-406) → `unpauseActivity(userId)`. All resolve by `userId` only (sole child).
- `routeCommand` (216-258) dispatches the oneof; pass `cmd.sessionId` from each command into the handlers here.
- `handleSessionRevoked` (198-214) stops the single active session — exact current body:
  ```ts
  const sessionId =
    this.activityEngine.getActiveSession(payload.userId)?.sessionId ?? null;
  try {
    await this.activityEngine.stopActivity(payload.userId);
  } catch (err: unknown) {
    this.logger.error(
      `Failed to stop activity on session revoke: userId=${payload.userId}`,
      err,
    );
    if (sessionId !== null) {
      this.eventEmitter.emit(SessionEvents.REVOKED, { sessionId });
    }
  }
  this.activeStreamRegistry.closeAll(payload.userId);
  ```

### Change
1. **Remove the singleton guard** (lines 281-290 above) in `handleActivityStart`. Allow N concurrent children.
2. **Idempotency:** add a short-window map keyed `${userId}:${clientActivityId}` → `sessionId` in a new service mirroring `RateLimiterService` (`src/realtime/services/rate-limiter.service.ts:8-32`). Mirror its shape exactly: a private `Map<string, Entry>`; a `record(key, sessionId, windowMs)` / `lookup(key, windowMs)` pair where `lookup` returns the stored `sessionId` only if `Date.now() - entry.storedAt < windowMs` (same staleness check as `consume` at line 16), else deletes and returns undefined; and an `evict(key)` doing `this.map.delete(key)` (line 29-31). Window = `WS_IDEMPOTENCY_WINDOW_MS` (default `10_000`) — see Blocking decisions. On `activity:start`: if `cmd.clientActivityId` is set and `lookup` hits → return the stored session's state instead of creating a duplicate; on create, `record` the token → new `session.id`. Missing `clientActivityId` → always create (back-compat). Evict on disconnect.
3. **Routing:** `handleActivityEnd/Stop/Pause/Resume` pass `cmd.sessionId` (the inlined proto field) to the engine as the **second positional arg** — `endActivity(userId, cmd.sessionId, cmd.clientTimestampMs)`, `stopActivity(userId, cmd.sessionId)`, `pauseActivity(userId, cmd.sessionId)`, `unpauseActivity(userId, cmd.sessionId)`. Fallback resolution when `cmd.sessionId` is **absent**:
   1. `getSoleChild(userId)` returns a child → use its `sessionId` (sole-child behaviour);
   2. `getSoleChild(userId)` is `undefined` AND `listLiveSessions(userId)` has no children → existing no-session error (engine returns `null`/throws `Error('no_active_session')` → emit `code: 'no_active_session'`, as `handleActivityPause` already does at line 372);
   3. `getSoleChild(userId)` is `undefined` AND `listLiveSessions(userId)` shows >1 child → emit `session_error` with `code: 'AMBIGUOUS_SESSION'` and do NOT call the engine mutator (new constant, see below). Distinguish 0-vs->1 via `listLiveSessions`, never via `getSoleChild` alone.
4. `handleSessionRevoked`: enumerate `listLiveSessions(payload.userId)` and call `stopActivity(payload.userId, session.sessionId)` for **every** live session (root + each child) — not just `getActiveSession`. Then `activeStreamRegistry.closeAll(payload.userId)` (keep line 213). Collect each session's `sessionId` before stopping so the `SessionEvents.REVOKED` fallback emit (lines 209-211) fires per session on failure.

### New error code (follow existing convention)
- Declare in `src/realtime/constants/ws-error-codes.ts` (the `WsErrorCode` object, lines 1-9). The controller emits **SCREAMING_SNAKE** literal codes (`RATE_LIMIT_EXCEEDED`, `INVALID_COMMAND`, `INVALID_ACTIVITY_TYPE`, `NO_ACTIVE_SESSION`), matching the SCREAMING_SNAKE keys/values in that file (`RATE_LIMIT_EXCEEDED`, `NO_SESSION`, `SESSION_MISMATCH`). Add:
  ```ts
  AMBIGUOUS_SESSION: 'AMBIGUOUS_SESSION',
  ```
  (value identical to the key, SCREAMING_SNAKE — the convention for the controller-emitted codes; the lowercase entries are engine-`throw`-message codes and are not the right template here.)

### Config key (follow `RealtimeConfig` naming)
- Add to `src/realtime/constants/realtime-config.ts` (lines 1-14) following the `WS_*` / `RATE_LIMIT_*`-style pattern:
  ```ts
  IDEMPOTENCY_WINDOW_MS: 'WS_IDEMPOTENCY_WINDOW_MS',
  ```
  Read in the controller via `configService.get<number>(RealtimeConfig.IDEMPOTENCY_WINDOW_MS, 10_000)`, mirroring the `rateLimitWindowMs` read at lines 81-84.

### Guards / gotchas
- Rate limiter for `activity:start` (`activity-start:${userId}`, lines 265-269) stays — it caps creation rate regardless of tokens.
- Concurrent same-type starts are allowed (no UI path produces them, but the token still dedups true retries — see discussion: do not add "one type per user" protection).
- Idempotency map must not leak: evict on stream teardown alongside `this.rateLimiterService.evict(`activity-start:${userId}`)` (line 193) in the teardown block (lines 177-194).
- Pause/resume still mutate only in-memory `isPaused` on the addressed child.

### Verify
- Two `activity:start` with different `client_activity_id` → two children, two distinct `moduleSessionId`.
- Same `client_activity_id` twice within window → one child.
- `activity:pause` with `session_id=A` pauses A while B stays active.
- `activity:end` with no `session_id` and two active children → `AMBIGUOUS_SESSION`.

## Open Questions
- Idempotency window length moved to **Blocking decisions** (recommended 10_000 ms via `WS_IDEMPOTENCY_WINDOW_MS`).

## Test reconciliation (committed tests)

### GREEN list — RED→GREEN cases in `src/realtime/concurrency-idempotency.spec.ts` spec 06 must flip
- Concurrent-start (guard removal): `should create two distinct children for two activity:start with different clientActivityId` (spec:247); `should NOT return an existing session just because one is already active` (spec:272). ← removing the guard at controller:281-290.
- Idempotency dedup: `should return the same moduleSessionId for a repeat clientActivityId within the window` (spec:310, TARGET); `should create a new session for a repeat clientActivityId after the window` (spec:330, CHAR — advances 10_001 ms); `should scope the dedup token per user` (spec:355, CHAR — key `${userId}:${clientActivityId}`); `should always create a new session when clientActivityId is absent` (spec:377, CHAR); `should evict the token map on stream teardown` (spec:396, CHAR).
- session_id routing: `should route pause/resume/end/stop to the child named by sessionId as the second positional argument` (spec:430); `should fall back to the sole child when sessionId is absent and exactly one child exists` (spec:480); `should emit sessionError.code === 'AMBIGUOUS_SESSION' when sessionId is absent and >1 child is active` (spec:504).
- Revoke fan-out: `should call stopActivity(userId, sessionId) for every live session and closeAll once` (spec:543) — `listLiveSessions` returns 3 → `stopActivity` 3× with `(userId, sessionId)`, `closeAll` once.

### Symbols spec 06 OWNS adding (both verified ABSENT today)
- `AMBIGUOUS_SESSION: 'AMBIGUOUS_SESSION'` → add to `src/realtime/constants/ws-error-codes.ts` (value===key, SCREAMING_SNAKE). Referenced by spec:529 as the literal string `'AMBIGUOUS_SESSION'`.
- `IDEMPOTENCY_WINDOW_MS: 'WS_IDEMPOTENCY_WINDOW_MS'` → add to `src/realtime/constants/realtime-config.ts`; read with default **10_000**. Spec mock returns 10_000 for this exact key (spec:108).
- (`NO_ROOT_SESSION` already exists in ws-error-codes.ts line 4 and is NOT referenced by the committed spec — no action.)

### Pinned signatures / accessors (close GAP-B, GAP-C)
- **Arg order (GAP-B):** `endActivity(userId, sessionId, clientTimestampMs)` — spec:469-473 asserts exactly `endActivity('user-1', 'session-A', undefined)`. Do NOT use `(userId, clientTimestampMs, sessionId)`. Companions: `pauseActivity(userId, sessionId)`, `unpauseActivity(userId, sessionId)`, `stopActivity(userId, sessionId)`.
- **Resolution accessors (GAP-C):** absent-`session_id` sole-child branch uses `getSoleChild(userId)` (spec:482, 498-501); ambiguity branch detects via `listLiveSessions(userId).length > 1` (spec:508-511) — NOT via `getSoleChild` returning undefined (that conflates 0 children with >1). On ambiguity emit `AMBIGUOUS_SESSION` and do NOT call the engine mutator (spec:531).

## Anti-targets — committed tests spec 06 must delete/invert

These live in `src/realtime/module-state.grpc.controller.spec.ts` (the OLD characterization suite), are GREEN today, and break or assert wrong behavior once the guard is removed and engine signatures gain `sessionId`. Spec 06 OWNS migrating all of them (note 03 makes `sessionId` optional, so the absent-`session_id` sole-child fallback yields `(userId, <soleChildId-or-undefined>)`).

### DELETE (singleton-guard echo tests — directly contradict the concurrent-start TARGETs)
- `:652-663` — `should emit sessionState ACTIVE with existing moduleSessionId when activityEngine.getActiveSession returns a session` — asserts the guard echoes `session-1`. Contradicts spec:272.
- `:665-675` — `should not call activityEngine.startActivity when an active session already exists` — asserts `startActivity` NOT called when a session exists. Contradicts spec:247/272.
- `:760-771` — `should omit the isPaused field from the emitted sessionState when returning an existing session` — exercises the removed guard's echo branch; the branch no longer exists.

### INVERT/UPDATE (routing chars asserting userId-only call shape — break when signatures gain `sessionId`)
- `:777-787` — `should call activityEngine.endActivity(userId)` asserts `endActivity('user-1', undefined)` → new: `endActivity('user-1', <soleChild-or-undefined>, undefined)`.
- `:829-836` — `should call activityEngine.stopActivity(userId)` asserts `stopActivity('user-1')` → new: `stopActivity('user-1', <soleChild>)`.
- `:881-892` — `should call activityEngine.pauseActivity(userId)` asserts `pauseActivity('user-1')` → new: `pauseActivity('user-1', <soleChild>)`.
- `:947-958` — `should call activityEngine.unpauseActivity(userId)` asserts `unpauseActivity('user-1')` → new: `unpauseActivity('user-1', <soleChild>)`.
- `:567-569` — `handleSessionRevoked › should call activityEngine.stopActivity(payload.userId)` asserts `stopActivity('user-1')` (1 arg) → new fan-out passes `(userId, sessionId)`; supersede with spec:543's contract.

Note: the four routing chars use a mock engine (controller.spec.ts:28-39) with no `getSoleChild`/`listLiveSessions`; spec 06 must update them in lockstep with the controller or they go RED-for-the-wrong-reason.
