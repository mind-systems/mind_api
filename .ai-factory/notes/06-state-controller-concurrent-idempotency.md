# State controller: concurrent activities + idempotency dedup + session_id routing

**Date:** 2026-06-28
**Source:** conversation context

## Decisions (locked)
- Idempotency dedup window = **10_000 ms**, config key `WS_IDEMPOTENCY_WINDOW_MS` (default `10_000`) added to `src/realtime/constants/realtime-config.ts`. The `(userId, client_activity_id) → sessionId` map evicts entries past this TTL and on stream teardown.

## Key Findings

- This is where concurrent activities become *usable*: the controller drops the singleton "existing → return" guard, routes pause/resume/end/stop to the child named by `cmd.session_id`, and replaces the old implicit dedup (one-session-per-user) with explicit `client_activity_id` idempotency.
- Depends on the multi-session engine ([[03-multi-session-store-engine]]), lazy root ([[04-lazy-root-creation]]), and the proto fields ([[05-proto-session-id-idempotency]]).

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
3. **Routing:** `handleActivityEnd/Stop/Pause/Resume` pass `cmd.sessionId` to the engine. Fallback resolution order for an **absent** `session_id`:
   1. exactly one active child → use it (current sole-child behaviour);
   2. zero active children → existing no-session error (engine returns `null`/throws `NO_ACTIVE_SESSION` → `WsErrorCode.NO_ACTIVE_SESSION` = `'no_active_session'`, as `handleActivityPause` already emits at line 372);
   3. more than one active child → emit `session_error` with `code: WsErrorCode.AMBIGUOUS_SESSION` (new constant, see below).
4. `handleSessionRevoked`: stop **all** children + the root (loop over every active session for `payload.userId`, not just `getActiveSession`), then `activeStreamRegistry.closeAll(payload.userId)` (keep line 213). Collect each child's `sessionId` before stopping so the `SessionEvents.REVOKED` fallback emit (lines 209-211) fires per child on failure.

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
