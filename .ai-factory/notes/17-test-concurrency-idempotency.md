# Test plan — concurrent activities + idempotency dedup (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[06-state-controller-concurrent-idempotency]].

## Blocking decisions
- **Proto fields `clientActivityId` / `sessionId` do not exist yet** in the generated stubs (`proto/generated/module_state.ts`: `ActivityStartCmd` has only `activityType`, `refId`, `clientTimestampMs` — lines 48-58; `ActivityEnd/Stop/Pause/ResumeCmd` carry no `sessionId`). They are added by [[05-proto-session-id-idempotency]] (`clientActivityId` on start, `sessionId` on end/stop/pause/resume). These tests reference those fields via `(cmd as any).clientActivityId` / `(cmd as any).sessionId` so they compile **before** spec 05 lands. Confirm the generated camelCase names are `clientActivityId` and `sessionId` once spec 05 regenerates.

## Test authoring constraints (the four lessons)
- **L1 — outcomes only:** the idempotency dedup and revoke tests assert observable OUTPUTS (the emitted `StateResponse` `moduleSessionId` / `sessionError.code` on the captured subscriber), never the internal `Map<`${userId}:${clientActivityId}`, …>` shape — spec 06 owns that map's structure. "Revoke stops all" asserts every child + the root reached a stopped/closed state (e.g. `stopActivity` invoked per sessionId and `closeAll` called), NOT the contents of any internal collection.
- **L2 — compile-now:** new proto fields accessed via `(cmd as any).clientActivityId` / `(cmd as any).sessionId`. `clientTimestampMs` is typed `number` on both the DTO (`activity-start.dto.ts:14`) and the proto (`module_state.ts:57`) — pass a plain number; no `Long` fixture is needed in this note.
- **L3 — label by spec name:** mark every target case `RED until spec 06-state-controller-concurrent-idempotency` (and note the proto dependency on `spec 05-proto-session-id-idempotency`). Never use a phase number.
- **L4 — escalation valve:** the singleton "existing → return" guard is being *removed*, so there is no characterization here. If a case goes RED asserting a removed internal, it was mis-classified — move it, do not escalate.

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
- should route pause/resume/end/stop to the child named by `(cmd as any).sessionId` while siblings stay untouched — target→06
- should fall back to the sole child when `sessionId` is absent and exactly one exists — target→06
- should emit error code `AMBIGUOUS_SESSION` when `sessionId` absent and >1 child active — target→06 (assert it does NOT pick one silently)
### Revoke
- should stop all children + the root on session revoke, then `closeAll` — target→06 (assert the OUTCOME: `stopActivity`/stop invoked for every live sessionId and `activeStreamRegistry.closeAll(userId)` called — never assert an internal session map)

## Exact pins (read from source)
- **New error code:** spec 06 adds `AMBIGUOUS_SESSION: 'AMBIGUOUS_SESSION'` to `src/realtime/constants/ws-error-codes.ts` (currently lines 1-10, SCREAMING_SNAKE convention; value === key). Assert the literal string `'AMBIGUOUS_SESSION'` on `sessionError.code`. (It does not exist yet — RED until spec 06.)
- **Idempotency window:** config key `WS_IDEMPOTENCY_WINDOW_MS`, default `10_000` ms (spec 06 Blocking decision; add to `RealtimeConfig` as `IDEMPOTENCY_WINDOW_MS`). Use this exact default in fake-timer expiry tests.
- **Rate limiter:** `RateLimiterService.consume(key, limit, windowMs)` (`rate-limiter.service.ts:12`), key `activity-start:${userId}` (`module-state.grpc.controller.ts:266`). The current singleton guard to be removed is `module-state.grpc.controller.ts:281-290` (`getActiveSession(userId)` → `existing → return`).
- **Error transport:** errors are `subscriber.next({ sessionError: { code, message, timestamp } })`, NOT thrown (e.g. `RATE_LIMIT_EXCEEDED` at `module-state.grpc.controller.ts:271-278`). Assert on the captured `next()` payload's `sessionError.code`.
- **Engine accessors not-yet-existing:** spec 06 needs to enumerate every live session per user (root + children) for revoke — today only `getActiveSession(userId)` exists (`activity-engine.service.ts:401`). Access the new enumerator via `(engine as any).<method>` so the test compiles before spec 03/06.

## Gotchas
- Idempotency window is time-based — use fake timers to test expiry against the `10_000` default.
- Rate limiter still applies to `activity:start`; mock `consume` to return `true` to isolate dedup from rate limiting.
- Errors are emitted as `session_error` events on the stream, not thrown — assert on the captured next() payload `code`.

## Findings
_(fill during test-writing; escalate to [[06-state-controller-concurrent-idempotency]] before implementing it)_
