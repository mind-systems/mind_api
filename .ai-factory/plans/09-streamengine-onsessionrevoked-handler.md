# Plan: StreamEngine.onSessionRevoked handler

## Context
Add a `SessionEvents.REVOKED` listener to `StreamEngine` that flushes and discards the in-memory sample buffer for the revoked session, mirroring the existing `onSessionInterrupted` handler.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Implementation

- [x] **Task 1: Add `onSessionRevoked` handler to `StreamEngine`**
  Files: `src/realtime/services/stream-engine.service.ts`
  Append a new method below `onSessionInterrupted`:
  ```typescript
  @OnEvent(SessionEvents.REVOKED)
  async onSessionRevoked(payload: { sessionId: string }): Promise<void> {
    this.logger.log(
      `onSessionRevoked: flushing sessionId=${payload.sessionId}`,
    );
    await this.flush(payload.sessionId);
    this.buffers.delete(payload.sessionId);
    this.logger.log(
      `onSessionRevoked: buffer cleared for sessionId=${payload.sessionId}`,
    );
  }
  ```
  The body is a verbatim copy of `onSessionInterrupted` with the log messages changed to `onSessionRevoked`. No other changes are required — `SessionEvents.REVOKED` already exists in `src/realtime/events/session.events.ts`, and `OnEvent` / `SessionEvents` are already imported at the top of the file.

<!-- orchestrator-sessions
planner: 06465ffd-4ba3-4326-ac30-f55d8450965e
elapsed: 225
implementer: 88801df9-f660-49d1-9267-d019ae139801
-->
