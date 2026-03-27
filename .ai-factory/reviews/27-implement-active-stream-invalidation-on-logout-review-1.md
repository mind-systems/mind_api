## Code Review Summary

**Files Reviewed:** 8 (3 new, 5 modified)
**Risk Level:** 🟡 Medium

### Context Gates

- **ARCHITECTURE.md** — WARN: `ModuleSessionGrpcController` imports `AuthEvents` from `../users/events/auth.events`. This crosses module boundaries (realtime → users). The constant is a plain `as const` object (not a provider), so no runtime coupling is introduced. Acceptable — but ideally event constants shared between modules would live in a shared location or be re-exported from the module's public surface.
- **RULES.md** — no violations. No non-null assertions, no sensitive data in logs, logs are lean.
- **ROADMAP.md** — roadmap item 6.1 correctly marked `[x]`.

### Critical Issues

**1. `handleSessionRevoked` — unguarded `stopActivity` prevents `closeAll` from running**

File: `src/realtime/module-session.grpc.controller.ts:152-156`

```typescript
@OnEvent(AuthEvents.SESSION_REVOKED)
async handleSessionRevoked(payload: { userId: string }): Promise<void> {
  await this.activityEngine.stopActivity(payload.userId);  // can throw
  this.activeStreamRegistry.closeAll(payload.userId);       // never reached if above throws
}
```

`stopActivity` performs two DB calls (`repo.findOne` and `repo.save`) — either can throw on a connection error or transient DB failure. If that happens:

1. **`closeAll` is never called** — all active gRPC streams for that user remain open after the `user_sessions` row has already been deleted. The revocation silently fails to disconnect the user.
2. **Unhandled promise rejection** — `SessionService.revoke()` calls `this.eventEmitter.emit()` (not `emitAsync`), so the handler's returned Promise is not tracked by the emitter. A rejection becomes an unhandled promise rejection, which depending on `--unhandled-rejections` mode could crash the process.

Fix — wrap in try/catch so `closeAll` always runs:

```typescript
@OnEvent(AuthEvents.SESSION_REVOKED)
async handleSessionRevoked(payload: { userId: string }): Promise<void> {
  try {
    await this.activityEngine.stopActivity(payload.userId);
  } catch (err: unknown) {
    this.logger.error(`Failed to stop activity on session revoke: userId=${payload.userId}`, err);
  }
  this.activeStreamRegistry.closeAll(payload.userId);
}
```

### Suggestions

**2. `SessionRevokedPayload` exported but never imported**

File: `src/users/events/auth.events.ts:5-7`

The interface `SessionRevokedPayload` is defined and exported but never used anywhere — the `handleSessionRevoked` handler uses inline `{ userId: string }`. Either use the interface in the handler (and anywhere else the payload is constructed) or remove it to avoid dead code.

### Positive Notes

- **Clean decoupling via EventEmitter2** — `AuthModule` and `RealtimeModule` don't import each other; only a plain constant is shared. Good separation.
- **`closeAll` Set mutation during iteration is safe** — `subscriber.complete()` synchronously triggers `deregister`, which deletes the current element from the Set. Per the ES spec, `for...of` on Set correctly handles mid-iteration deletions. Verified correct.
- **`stopActivity` before `closeAll` interaction is well-designed** — `stopActivity` clears the `activitySessionStore` entry, so the subscriber teardown's `handleTransportDisconnect` finds no entry and skips the grace timer. No pointless abandon timer runs.
- **`onModuleDestroy` cleanup in `ActiveStreamRegistry`** — follows the `SyncStreamService` pattern. Ensures all subscribers are completed on app shutdown.
- **Test coverage updated correctly** — the spec properly tests both the happy path (findOne returns session → delete + emit) and the null path (findOne returns null → early return, no delete, no emit).
- **TOCTOU between `findOne` and `delete` in `revoke()`** — benign race. Another process could delete the same session between the two calls. Impact: `delete` affects 0 rows, event fires, `stopActivity`/`closeAll` are no-ops. Harmless.
