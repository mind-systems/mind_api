# State controller: concurrent activities + idempotency dedup + session_id routing

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- This is where concurrent activities become *usable*: the controller drops the singleton "existing → return" guard, routes pause/resume/end/stop to the child named by `cmd.session_id`, and replaces the old implicit dedup (one-session-per-user) with explicit `client_activity_id` idempotency.
- Depends on the multi-session engine ([[03-multi-session-store-engine]]), lazy root ([[04-lazy-root-creation]]), and the proto fields ([[05-proto-session-id-idempotency]]).

## Details

### Current state — `src/realtime/module-state.grpc.controller.ts`
- `handleActivityStart`: rate-limit, then `const existing = getActiveSession(userId); if (existing) return current state;` — this singleton guard blocks any second concurrent start.
- `handleActivityEnd/Stop/Pause/Resume` call the engine by `userId` only (resolve the sole child).
- `handleSessionRevoked` stops the single active session.

### Change
1. **Remove the singleton guard** in `handleActivityStart`. Allow N concurrent children.
2. **Idempotency:** add a short-window map keyed `(userId, client_activity_id) → sessionId` (e.g. in a small service mirroring `RateLimiterService`, TTL ~10s). On `activity:start`: if the token was seen → return the existing session's state instead of creating a duplicate. Missing token → always create (back-compat). Evict on disconnect.
3. **Routing:** `handleActivityEnd/Stop/Pause/Resume` pass `cmd.session_id` to the engine. If `session_id` absent: fall back to the single active child if exactly one exists; if zero → existing no-session error; if more than one → emit `session_error` code `AMBIGUOUS_SESSION`.
4. `handleSessionRevoked`: stop **all** children + the root (loop), then `closeAll`.

### Guards / gotchas
- Rate limiter for `activity:start` (`activity-start:${userId}`) stays — it caps creation rate regardless of tokens.
- Concurrent same-type starts are allowed (no UI path produces them, but the token still dedups true retries — see discussion: do not add "one type per user" protection).
- Idempotency map must not leak: evict on stream teardown alongside `rateLimiterService.evict`.
- Pause/resume still mutate only in-memory `isPaused` on the addressed child.

### Verify
- Two `activity:start` with different `client_activity_id` → two children, two distinct `moduleSessionId`.
- Same `client_activity_id` twice within window → one child.
- `activity:pause` with `session_id=A` pauses A while B stays active.
- `activity:end` with no `session_id` and two active children → `AMBIGUOUS_SESSION`.

## Open Questions
- Exact idempotency window length — start at 10s, tune if mobile retry backoff is longer.
