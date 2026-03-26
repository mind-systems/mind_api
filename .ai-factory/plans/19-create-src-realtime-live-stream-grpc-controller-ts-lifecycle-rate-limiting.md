# Plan: LiveStreamGrpcController — lifecycle + rate limiting

## Context
Fill in the empty teardown stub in `live-stream.grpc.controller.ts` (lines 131-134) with the full disconnect lifecycle: mark the session as disconnected, start a grace timer for reconnection, log connection duration, and clean up the rate-limiter window — all keyed by `userId`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Disconnect lifecycle

- [x] **Task 1: Implement stream teardown with disconnect + grace timer**
  Files: `src/realtime/live-stream.grpc.controller.ts`
  Replace the empty teardown stub (`subscriber.add(() => { // TODO ... })` at lines 131-134) with the full disconnect lifecycle, mirroring `LiveGateway.handleDisconnect` (lines 137-181 of `src/realtime/gateways/live.gateway.ts`). Inside the teardown callback:
  1. Call `this.presenceService.offline(userId)`.
  2. Call `await this.activityEngine.onDisconnect(userId)` — this marks the DB session as `DISCONNECTED` and sets `disconnectedAt`, but keeps the entry in `activityMap`.
  3. After `onDisconnect` resolves: if `this.stateStore.activityMap.has(userId)`, call `this.graceTimerManager.startTimer(userId, () => { this.activityEngine.abandonActivity(userId) })` — on timer expiry the session transitions to `ABANDONED`.
  4. Wrap the async work in an IIFE with `.catch()` that logs errors (same pattern as the gateway: `this.logger.error('Failed to record disconnect: userId=...',  err)`).

- [x] **Task 2: Track connectedAt and log connection duration on disconnect**
  Files: `src/realtime/live-stream.grpc.controller.ts`
  Use the existing `PresenceState.connectedAt` (set by `presenceService.online()` on line 98) for duration tracking — no extra map needed. In the teardown callback, **before** calling `presenceService.offline()` (which deletes the entry), read `this.presenceService.get(userId)?.connectedAt`. Compute `connectedDurationMs = Date.now() - connectedAt.getTime()` (fallback to `0` if undefined). Log: `this.logger.log('Disconnected: userId=${userId} connectedDurationMs=${connectedDurationMs}')`.

- [x] **Task 3: Evict rate-limiter window by userId on disconnect**
  Files: `src/realtime/live-stream.grpc.controller.ts`
  At the end of the teardown callback, call `this.rateLimiterService.evict('activity-start:${userId}')`. This matches the key format used by `consume()` in `handleActivityStart` (line 183: `activity-start:${userId}`). The WS gateway evicts by `client.id` because `WsRateLimitGuard` also rate-limits at the socket level — that guard doesn't exist in the gRPC path, so only the `activity-start:` prefixed key needs eviction.
