## Plan Review Summary

**Plan:** `09-streamengine-onsessionrevoked-handler.md`
**Files Targeted:** 1 (`src/realtime/services/stream-engine.service.ts`)
**Risk Level:** 🟢 Low

### Context Gates
- **ARCHITECTURE.md (WARN):** No architectural concerns — the change stays within the `realtime` module and uses the existing event-driven pattern. No new dependencies or boundary crossings.
- **RULES.md (WARN):** The plan adds entry/exit `logger.log` lines, which technically conflicts with the "Keep logs lean" rule ("Do NOT log function entry/exit or intermediate state"). However, the plan explicitly mirrors the existing `onSessionInterrupted` / `onSessionAbandoned` / `onSessionCompleted` handlers, which all use the same two-line pattern. Consistency wins here — not a blocker, but the broader cleanup (if ever pursued) should affect all four handlers uniformly.
- **ROADMAP.md:** Not blocking; trivial fix-style task.

### Verification of Plan Claims
- ✅ `SessionEvents.REVOKED` exists in `src/realtime/events/session.events.ts:5` as `'session.revoked'`.
- ✅ `OnEvent` is already imported (`stream-engine.service.ts:10`).
- ✅ `SessionEvents` is already imported (`stream-engine.service.ts:17`).
- ✅ The proposed handler body is structurally identical to `onSessionInterrupted` (lines 188–198) with only the log labels changed — correct.
- ✅ No migrations or schema changes are required.
- ✅ No security implications — `sessionId` is an internal UUID, safe to log.
- ✅ `flush(sessionId)` followed by `buffers.delete(sessionId)` matches the established lifecycle pattern in this file; the order is important (flush before delete) and the plan preserves it.

### Observations (Non-blocking)

**1. The REVOKED event is currently emitted only in an error path.**
`module-state.grpc.controller.ts:179` emits `SessionEvents.REVOKED` only inside the `catch` block when `activityEngine.stopActivity()` fails:

```typescript
} catch (err: unknown) {
  ...
  if (sessionId !== null) {
    this.eventEmitter.emit(SessionEvents.REVOKED, { sessionId });
  }
}
```

The success path of `handleSessionRevoked` does **not** emit `SessionEvents.REVOKED`. This means the new `StreamEngine.onSessionRevoked` handler will fire only when `stopActivity` throws. This is likely intentional (the success path presumably triggers other cleanup downstream via `activityEngine`), but it's worth confirming during implementation that this listener will actually be exercised in production. This is **out of scope** for the current plan but worth flagging — if the intent was "always flush buffer on session revocation," the emitter logic upstream may also need a change.

**2. Module event wiring.**
`StreamEngine` is registered as a provider inside the realtime module — since `@OnEvent` from `@nestjs/event-emitter` works only when `EventEmitterModule` is registered globally (which is the case, given the existing three `@OnEvent` decorators in the same file work today), no additional wiring is required.

### Critical Issues
None.

### Positive Notes
- The plan is precise: file path, exact insertion location, full method body, and a clear rationale.
- It correctly verified that imports already exist, avoiding unnecessary edits.
- It mirrors the established pattern in the same file — predictable and low-risk.
- Scope is appropriately narrow (one file, one method).

PLAN_REVIEW_PASS
