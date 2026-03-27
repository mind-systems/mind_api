## Code Review Summary

**Plan:** `18-create-src-realtime-live-stream-grpc-controller-ts-session-routing.md`
**Commit:** `5888bd1`
**Files Reviewed:** 2 (`src/realtime/live-stream.grpc.controller.ts`, `src/realtime/realtime.module.ts`)
**Risk Level:** 🟡 Medium

### Context Gates

- **ARCHITECTURE.md** — `PASS`: Controller is thin, delegates all logic to `ActivityEngine`, `PresenceService`, `RateLimiterService`. Enum mapping is a top-level pure function. No cross-module boundary violations.
- **RULES.md** — `PASS`: No PII in logs (only `userId` and `sessionId`). No non-null assertions. Logging is lean (errors + key outcomes).
- **ROADMAP.md** — `PASS`: Directly implements the roadmap item for session routing. Teardown stub with TODO for lifecycle plan is present.

### Critical Issues

**1. `setup()` failure leaves stream open indefinitely**

`src/realtime/live-stream.grpc.controller.ts:120-129`

```typescript
setup().catch((err: unknown) => {
  this.logger.error(`Stream setup failed: userId=${userId}`, err);
  subscriber.next({
    sessionError: {
      code: 'INTERNAL_ERROR',
      message: 'Stream setup failed',
      timestamp: Date.now(),
    },
  });
});
```

If `setup()` rejects (e.g. `resumeActivity()` throws a DB error), the catch handler sends a `SessionErrorEvent` but never closes the stream. The `request` observable is never subscribed to (subscription happens inside `setup()`), so client messages are buffered by the gRPC transport indefinitely. The stream only ends when the client cancels or the transport times out.

Fix — add `subscriber.complete()` after the error event:

```typescript
setup().catch((err: unknown) => {
  this.logger.error(`Stream setup failed: userId=${userId}`, err);
  subscriber.next({
    sessionError: {
      code: 'INTERNAL_ERROR',
      message: 'Stream setup failed',
      timestamp: Date.now(),
    },
  });
  subscriber.complete();
});
```

**2. `mapProtoActivityType` validation error swallowed by generic catch**

`src/realtime/live-stream.grpc.controller.ts:138-175`

`mapProtoActivityType` throws `RpcException({ code: INVALID_ARGUMENT, message: 'Unsupported activity type: ...' })` for `UNSPECIFIED`/`UNRECOGNIZED` values. This exception propagates from `handleActivityStart` up to `routeCommand`'s outer catch:

```typescript
} catch (err: unknown) {
  this.logger.error(`Unexpected error handling command: userId=${userId}`, err);
  subscriber.next({
    sessionError: {
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
      timestamp: Date.now(),
    },
  });
}
```

The client receives `code: 'INTERNAL_ERROR'` instead of `code: 'INVALID_ARGUMENT'` with the specific message. The client cannot distinguish a validation error (their fault, fixable) from a server failure (our fault, not fixable).

Fix — catch the `RpcException` locally in `handleActivityStart` before `startActivity`:

```typescript
let activityType: InternalActivityType;
try {
  activityType = mapProtoActivityType(cmd.activityType);
} catch {
  subscriber.next({
    sessionError: {
      code: 'INVALID_ACTIVITY_TYPE',
      message: `Unsupported activity type: ${cmd.activityType}`,
      timestamp: Date.now(),
    },
  });
  return;
}
```

This keeps the outer `routeCommand` catch as a pure safety net for unexpected errors, while giving the client a specific error code for invalid input.

**3. No `subscriber.closed` guard after async operations in `setup()`**

`src/realtime/live-stream.grpc.controller.ts:86-105`

If the gRPC stream closes while `setup()` is awaiting `resumeActivity()`, the teardown fires (the TODO stub). When `resumeActivity` resolves, `setup()` continues and calls `presenceService.online(userId, userId)` — marking the user as online after they already disconnected. Since the teardown stub has no cleanup, the user stays `online` in `presenceMap` permanently.

Fix — add a guard after the async operation:

```typescript
const setup = async (): Promise<void> => {
  if (this.stateStore.activityMap.has(userId)) {
    this.graceTimerManager.cancelTimer(userId);
    const session = await this.activityEngine.resumeActivity(userId);
    if (subscriber.closed) return;          // <-- guard
    if (session) {
      subscriber.next({ ... });
    }
  }

  if (subscriber.closed) return;            // <-- guard
  this.presenceService.online(userId, userId);
  // ... subscribe to request
};
```

### Positive Notes

- Clean separation: controller is a pure routing layer that delegates every operation to domain services — no business logic leaked in.
- Auth handling correctly reads from metadata via `GRPC_USER_KEY` symbol rather than relying on parameter decorator injection, which is the safer approach for bidi stream methods.
- Rate limiting, reconnect detection, and all command routing match the existing `LiveGateway` behavior faithfully.
- The `subscriber.add(() => cmdSub.unsubscribe())` pattern ensures the inner subscription is cleaned up on stream close.
- Module registration is minimal — only the controller added, all providers already available.
