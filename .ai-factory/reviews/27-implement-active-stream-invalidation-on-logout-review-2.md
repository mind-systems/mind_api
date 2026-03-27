## Patch Review — round 2

**Patch:** `patches/27-implement-active-stream-invalidation-on-logout-patch-1.md`
**Changes:** 2 source files modified (`module-session.grpc.controller.ts`, `session.service.ts`)
**Compilation:** Clean (`tsc --noEmit` passes)
**Tests:** 6/6 `SessionService` tests pass

---

### Fix 1 verified: `handleSessionRevoked` try/catch guard

`src/realtime/module-session.grpc.controller.ts:153-161`

```typescript
@OnEvent(AuthEvents.SESSION_REVOKED)
async handleSessionRevoked(payload: SessionRevokedPayload): Promise<void> {
  try {
    await this.activityEngine.stopActivity(payload.userId);
  } catch (err: unknown) {
    this.logger.error(`Failed to stop activity on session revoke: userId=${payload.userId}`, err);
  }
  this.activeStreamRegistry.closeAll(payload.userId);
}
```

- `closeAll` is now unconditional — streams are always terminated even if `stopActivity` fails on a DB error.
- The catch block logs the error with `userId` for traceability without leaking sensitive data (compliant with RULES.md).
- No unhandled promise rejection risk — the entire async body is guarded.
- On the error path, the `activitySessionStore` entry may not be cleared, so the subscriber teardown's `handleTransportDisconnect` could still find it and start a grace timer. This is acceptable — the grace timer fires, calls `abandonActivity`, which either marks the session ABANDONED (harmless — the user's auth session is already deleted) or finds the DB row already cleaned up and no-ops.

### Fix 2 verified: `SessionRevokedPayload` wired through

- `src/users/events/auth.events.ts` — interface unchanged, now actually used.
- `src/users/service/session.service.ts:7` — imports `SessionRevokedPayload`, uses it at line 45 to type the emit payload. No runtime change; adds compile-time contract enforcement.
- `src/realtime/module-session.grpc.controller.ts:28` — imports `SessionRevokedPayload` as a type-only import (`import type`). Used in the handler signature at line 154. If the payload shape ever changes in `auth.events.ts`, both the emitter and handler will get a compile error.

### No new issues found

Both fixes are minimal, correct, and introduce no new risk.

REVIEW_PASS
