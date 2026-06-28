# Multi-session store + engine refactor (behavior-preserving)

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- The hard structural keystone: `ActivitySessionStore` is `Map<userId, ActivityState>` — physically one session slot per user. Every `ActivityEngine` method resolves "the" session by `userId`. This must become per-user multi-session, with grace timers keyed by `sessionId`.
- This task is a **pure refactor**: external behavior stays identical (still one active child in practice). It only restructures the in-memory model and threads `sessionId` through the engine API. Concurrency becomes *possible* but is not yet *used* (that is [[06-state-controller-concurrent-idempotency]]).
- Cannot be split smaller: store, engine, and every caller compile together — one reason to revert.

## Details

### Current state
- `src/realtime/services/activity-session-store.service.ts` — `activityMap = Map<userId, ActivityState>`, `timers = Map<userId, Timeout>`. `get/set/has/delete(userId)`, `startGraceTimer(userId)`, `cancelGraceTimer(userId)`.
- `src/realtime/services/activity-engine.service.ts` — `endActivity/stopActivity/pauseActivity/unpauseActivity/resumeActivity/onDisconnect/abandonActivity(userId)` all call `store.get(userId)`. `abandonStale(userId, sessionId)` already takes a sessionId. `handleReconnect` / `handleTransportDisconnect(userId)`.
- Callers: `src/realtime/module-state.grpc.controller.ts` (`getActiveSession`, all handlers), `src/realtime/services/session-watchdog.service.ts` (`abandonStale`), `handleSessionRevoked` (controller).

### Change
- Store → `Map<userId, UserSessions>` where
  ```ts
  interface UserSessions {
    rootSessionId: string | null;
    children: Map<string, ActivityState>; // keyed by sessionId
  }
  ```
  Grace timers → `Map<sessionId, Timeout>`. New helpers: `getChild(userId, sessionId)`, `listChildren(userId)`, `addChild`, `removeChild`, `getRoot(userId)`, `setRoot`.
- Engine methods take explicit `sessionId`: `endActivity(userId, sessionId, ts)`, `stopActivity(userId, sessionId)`, `pauseActivity(userId, sessionId)`, `unpauseActivity(userId, sessionId)`, `resumeActivity(userId, sessionId)`, `onDisconnect`/`abandonActivity(userId, sessionId)`.
- `handleTransportDisconnect(userId)` now iterates **all** of the user's live sessions (root + children), disconnecting each and starting a per-session grace timer.
- `handleReconnect(userId)` resumes all `disconnected` sessions for the user.

### Behavior preservation (this task only)
The proto does not yet carry `session_id` (added in [[05-proto-session-id-idempotency]]). So `module-state.grpc.controller.ts` resolves the target child as the single active one (assert exactly one; if zero → existing no-session handling; if >1 cannot happen yet). `getActiveSession(userId)` kept as a convenience that returns the sole child. Net external behavior unchanged.

### Guards / gotchas
- `handleSessionRevoked` must stop **every** child + the root (loop), then `closeAll`.
- Watchdog `abandonStale(userId, sessionId)` already sessionId-scoped — just ensure store lookups use the child map.
- Do not introduce root creation here — that is [[04-lazy-root-creation]]. Root field exists in `UserSessions` but stays null in this task.

### Verify
- `npm test` + existing realtime e2e (single-session flows) stay green.
- Build clean; no `store.get(userId)` singletons remain in the engine.

## Open Questions
- None.
