# Reconnect with no recoverable session emits a terminal ABANDONED event

**Date:** 2026-06-22
**Source:** conversation context

## Key Findings

- When a client reconnects but its session was already abandoned (grace expired while backgrounded), `ModuleStateGrpcController` calls `handleReconnect(userId)` → **null** and sends the subscriber **no event at all**, then just starts listening for commands. The client never learns its session died, so it keeps streaming biometrics into a dead session (mobile sees a `NO_SESSION` flood; see mind_mobile notes 143/144).
- Fix: in the null branch, push a terminal `sessionState` with `ActivityStatus.ABANDONED`. The mobile client already maps `ABANDONED` → reset, so this single send closes the loop.

## Details

### Current state
`src/realtime/module-state.grpc.controller.ts` (~106-121): the reconnect `setup`:
```ts
const session = await this.activityEngine.handleReconnect(userId);
if (subscriber.closed) return;
if (session) {
  subscriber.next({ sessionState: { moduleSessionId: session.id, status: ActivityStatus.RESUMED, isPaused: false } });
  this.logger.log(`Session resumed on reconnect: ...`);
}
// null case: NOTHING sent
connectedAt = Date.now();
```
- `activity-engine.service.ts:431-435` `handleReconnect` → `null` when `!activitySessionStore.has(userId)` (grace already fired `abandonActivity`, which sets `status = ABANDONED`, `endedAt = now`, emits `SessionEvents.ABANDONED`).
- `proto/module_state.proto` `ActivityStatus`: `ACTIVE=1, DISCONNECTED=2, COMPLETED=3, ABANDONED=4, INTERRUPTED=5, RESUMED=6`. `StateResponse.oneof { StateEvent session_state = 1; StateErrorEvent session_error = 2; }`.

### Change
- In the `else` (null) branch of the reconnect `setup`, send a terminal event before subscribing to commands:
  ```ts
  } else {
    subscriber.next({ sessionState: { status: ActivityStatus.ABANDONED } });
    this.logger.log(`No recoverable session on reconnect: userId=${userId} — sent ABANDONED`);
  }
  ```
  No `moduleSessionId` (session is gone), `isPaused` false. The mobile `_processProtoEvent` maps `ABANDONED` → `ModuleSessionAbandoned` → clears client state (mind_mobile note 144).

### Guards
- Only the null/no-recoverable-session branch — keep the `RESUMED` send unchanged when a session IS recoverable.
- Send before subscribing to inbound commands; respect the existing `subscriber.closed` guard.
- Do not modify `handleReconnect`/grace/watchdog logic.
- Add/extend a controller test: reconnect after grace expiry emits exactly one `sessionState{ status: ABANDONED }`.

### Verify
- Integration: open stream → disconnect → let grace expire → reconnect → client receives one `sessionState` with `ABANDONED`.

## Open Questions
- None. Decided: reuse `sessionState{ ABANDONED }` (not a `sessionError`) — the mobile `_processProtoEvent` already maps `ABANDONED` → reset (`ModuleStateChannel.dart:136-138`), so no proto change and no new client branch.
