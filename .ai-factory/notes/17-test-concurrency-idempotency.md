# Test plan — concurrent activities + idempotency dedup (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[06-state-controller-concurrent-idempotency]].

## Why this area (silent-failure filter)
Dedup-with-wrong-key and command-routing are textbook silent bugs: a retried `activity:start` that creates a duplicate session, an idempotency key that collides across users, or `pause` routed to the wrong child — none throw, they corrupt session/stat data. The one loud path (`AMBIGUOUS_SESSION` error) must also be asserted so it does not silently fall back to the wrong child.

## Behavior under change — think hard before writing
The old singleton guard (`existing → return`) did double duty: it blocked concurrency AND deduped retries. Removing it splits those into two mechanisms. Enumerate every reason two `activity:start` could arrive (double tap, gRPC retry, true second activity) and confirm the new token logic classifies each correctly. If a case is ambiguous in [[06-state-controller-concurrent-idempotency]], record it under **Findings**.

## Red/Green contract
- **Target (RED until [[06-state-controller-concurrent-idempotency]]):** all cases below. The feature must not be implemented in the test task.
- No characterization here — this is all new behavior (the old singleton behavior is covered as char in [[16-test-session-lifecycle-state-machine]] and is being *removed*).

## Instantiation
Test `ModuleStateGrpcController` with a mocked `ActivityEngine`, `RateLimiterService`, `ActiveStreamRegistry`, `ConfigService`, `EventEmitter2`. Drive `routeCommand` with crafted `StateRequest` oneofs; capture emitted `StateResponse` via a fake `Subscriber`.

## Test cases
### Concurrent start
- should create two distinct children for two starts with different `client_activity_id` — target→06
- should NOT return an existing session just because one is already active (singleton guard gone) — target→06
### Idempotency
- should return the same sessionId for a repeat `client_activity_id` within the window — target→06
- should scope the token per user (same token, different user → different session) — target→06
- should always create when `client_activity_id` is absent (back-compat) — target→06
- should evict the token map on stream teardown (no cross-connection leak) — target→06
### session_id routing
- should route pause/resume/end/stop to the child named by `cmd.session_id` while siblings stay untouched — target→06
- should fall back to the sole child when `session_id` is absent and exactly one exists — target→06
- should emit `AMBIGUOUS_SESSION` when `session_id` absent and >1 child active — target→06 (assert it does NOT pick one silently)
### Revoke
- should stop all children + the root on session revoke, then closeAll — target→06

## Gotchas
- Idempotency window is time-based — use fake timers to test expiry.
- Rate limiter still applies to `activity:start`; mock `consume` to isolate dedup from rate limiting.
- Errors are emitted as `session_error` events on the stream, not thrown — assert on the captured next() payload `code`.

## Findings
_(fill during test-writing; escalate to [[06-state-controller-concurrent-idempotency]] before implementing it)_
