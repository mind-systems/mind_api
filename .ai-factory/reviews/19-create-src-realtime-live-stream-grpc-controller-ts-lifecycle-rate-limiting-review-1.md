# Review: LiveStreamGrpcController — lifecycle + rate limiting

## Files reviewed
- `src/realtime/live-stream.grpc.controller.ts` (lines 131-152 — teardown block)

## Reference files
- `src/realtime/gateways/live.gateway.ts` (lines 137-181 — `handleDisconnect`)
- `src/realtime/services/presence.service.ts`
- `src/realtime/services/activity-engine.service.ts`
- `src/realtime/services/grace-timer.service.ts`
- `src/realtime/services/rate-limiter.service.ts`

## Correctness

**connectedAt read order** — `presenceService.get(userId)?.connectedAt` is read before `offline()` deletes the entry. Correct.

**onDisconnect early-return** — `ActivityEngine.onDisconnect` returns early if no `activityMap` entry exists (line 142 of activity-engine.service.ts). Safe when teardown fires before any activity was started.

**Grace timer flow** — matches the gateway: `onDisconnect` → check `activityMap.has(userId)` → `startTimer` → `abandonActivity`. The `abandonActivity` method has its own guard (only transitions if status is still `DISCONNECTED`), so a late reconnect that resumes the session won't be overwritten.

**Rate limiter key** — `evict('activity-start:${userId}')` matches the `consume('activity-start:${userId}', ...)` call on line 201. Consistent.

**Async IIFE with `.catch()`** — matches the fire-and-forget pattern used in the gateway. Errors are logged, not swallowed silently.

**Early teardown edge case** — if the stream closes before `setup()` calls `presenceService.online()` (line 98), `get(userId)` returns `undefined`, `connectedDurationMs` falls back to `0`, and `offline()` / `onDisconnect()` are safe no-ops. Acceptable.

## No issues found

The teardown block faithfully mirrors `LiveGateway.handleDisconnect` with the expected adaptations for gRPC (userId-keyed everywhere, no socketMap eviction, no socket-level rate-limiter guard).

REVIEW_PASS
