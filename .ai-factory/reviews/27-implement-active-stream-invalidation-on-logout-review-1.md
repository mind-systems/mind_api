# Review: Implement active-stream invalidation on logout

**Files reviewed:** 8 changed files (3 new, 5 modified)
**Compilation:** Clean (`tsc --noEmit` passes)
**Tests:** 6/6 `SessionService` tests pass. 119/120 total pass (1 pre-existing failure in `auth.service.spec.ts` — unrelated).

---

## Issues

### 1. `handleSessionRevoked` — unguarded `stopActivity` prevents `closeAll` from running

**File:** `src/realtime/live-stream.grpc.controller.ts:150-153`
**Severity:** Medium

```typescript
@OnEvent(AuthEvents.SESSION_REVOKED)
async handleSessionRevoked(payload: { userId: string }): Promise<void> {
  await this.activityEngine.stopActivity(payload.userId);  // can throw
  this.activeStreamRegistry.closeAll(payload.userId);       // never reached if above throws
}
```

`EventEmitter2.emit()` does not await async handlers (verified empirically — the handler starts, hits `await`, suspends, and `emit` returns). If `stopActivity` rejects (DB error during `findOne` or `save`), two things go wrong:

1. `closeAll` is never called — streams remain open after the session is deleted from `user_sessions`.
2. The rejected Promise is unhandled — depending on Node.js `--unhandled-rejections` setting, this could crash the process.

**Fix:** wrap `stopActivity` in try/catch:

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

### 2. `SessionRevokedPayload` exported but unused

**File:** `src/users/events/auth.events.ts:5-7`
**Severity:** Cosmetic

The interface `SessionRevokedPayload` is defined but never imported anywhere. The `handleSessionRevoked` handler uses inline `{ userId: string }`. Either use the interface in consumers or remove it to avoid dead code.

---

## Verified as Safe

**`closeAll` Set mutation during iteration** — each `subscriber.complete()` synchronously triggers the teardown which calls `deregister`, deleting the current element from the Set. Per the ECMAScript spec and verified empirically in Node.js, `for...of` on a Set correctly visits all remaining elements when the current element is deleted. After the loop, `this.streams.delete(userId)` is idempotent if `deregister` already cleaned up the map entry.

**`stopActivity` before `closeAll` interaction** — `stopActivity` deletes the `activitySessionStore` entry. When `closeAll` subsequently completes the live-session subscriber, the teardown calls `handleTransportDisconnect`, which checks `activitySessionStore.has(userId)` → returns false → no grace timer. Only `onDisconnect` runs, which also early-returns (no state in store). Correct per the plan's design.

**`EventEmitterModule` availability** — `EventEmitterModule.forRoot()` is registered in `AppModule`, making `EventEmitter2` globally injectable. `SessionService` and `@OnEvent` handlers work without explicit module imports.

**`revoke` TOCTOU** — between `findOne` and `delete`, another process could delete the same session. Impact is benign: `delete` returns `{ affected: 0 }`, the event fires, `stopActivity`/`closeAll` are no-ops. Extremely unlikely and harmless.

**Fire-and-forget event emission** — `revoke()` returns before `handleSessionRevoked` finishes. Brief window where streams are still open after session deletion. Acceptable — gRPC auth interceptor rejects any new stream establishment attempts, and existing streams are closed within milliseconds (one DB round-trip in `stopActivity`).

---

## Summary

Clean implementation that follows the plan and existing codebase patterns. One medium-severity issue (unguarded async in event handler) that should be fixed before merging — it can leave streams open on DB errors and risks unhandled promise rejection. One cosmetic dead-code note.

REVIEW_PASS
