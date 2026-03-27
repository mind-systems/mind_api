# Patch: 27-implement-active-stream-invalidation-on-logout

Addresses issues raised in `reviews/27-implement-active-stream-invalidation-on-logout-review-1.md`.

---

## Fix 1 — Guard `stopActivity` with try/catch in `handleSessionRevoked`

**File:** `src/realtime/module-session.grpc.controller.ts`
**Lines:** 152–156
**Severity:** Critical

**Problem:** `stopActivity` performs DB calls (`repo.findOne`, `repo.save`) that can throw on transient failures. If it throws, `closeAll` is never reached — streams stay open after the session row is already deleted. The rejected Promise is also unhandled because `EventEmitter2.emit()` does not track async handler results.

**Current code:**

```typescript
@OnEvent(AuthEvents.SESSION_REVOKED)
async handleSessionRevoked(payload: { userId: string }): Promise<void> {
  await this.activityEngine.stopActivity(payload.userId);
  this.activeStreamRegistry.closeAll(payload.userId);
}
```

**Fixed code:**

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

**Why this works:** `closeAll` is now unconditional — it runs regardless of whether `stopActivity` succeeded. On the happy path, behavior is identical: `stopActivity` clears the `activitySessionStore` entry, then `closeAll` completes all subscribers. On the error path, the activity may remain in an inconsistent state (in-memory entry not cleared, DB row not updated), but the streams are still forcibly closed. The next client reconnection attempt will fail auth (session row is already deleted), so the stale in-memory state is harmless and will be cleaned up by the nightly purge or the next `handleTransportDisconnect`.

---

## Fix 2 — Use `SessionRevokedPayload` interface or remove it

**File:** `src/users/events/auth.events.ts`
**Lines:** 5–7
**Severity:** Cosmetic

**Problem:** `SessionRevokedPayload` is exported but never imported. The handler in `module-session.grpc.controller.ts` and the emit site in `session.service.ts` both use inline `{ userId: string }`.

**Option A — Use the interface (preferred):** Replace inline types with `SessionRevokedPayload` at both usage sites.

In `src/realtime/module-session.grpc.controller.ts`, change the import:

```typescript
// Current
import { AuthEvents } from '../users/events/auth.events';

// Fixed
import { AuthEvents, SessionRevokedPayload } from '../users/events/auth.events';
```

And change the handler signature:

```typescript
// Current
async handleSessionRevoked(payload: { userId: string }): Promise<void> {

// Fixed
async handleSessionRevoked(payload: SessionRevokedPayload): Promise<void> {
```

In `src/users/service/session.service.ts`, change the emit call to use a typed variable:

```typescript
// Current
this.eventEmitter.emit(AuthEvents.SESSION_REVOKED, { userId: session.userId });

// Fixed (no runtime change — just documents the contract)
const payload: SessionRevokedPayload = { userId: session.userId };
this.eventEmitter.emit(AuthEvents.SESSION_REVOKED, payload);
```

Add the import:

```typescript
import { AuthEvents, SessionRevokedPayload } from '../events/auth.events';
```

**Option B — Remove the dead interface:** Delete lines 5–7 from `src/users/events/auth.events.ts`.

---

## Commit plan

Single commit after both fixes: `"Guard stopActivity in handleSessionRevoked and wire SessionRevokedPayload"`
