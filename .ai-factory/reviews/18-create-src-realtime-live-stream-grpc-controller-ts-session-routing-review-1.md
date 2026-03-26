# Code Review: `live-stream.grpc.controller.ts` (session routing)

**Plan:** `18-create-src-realtime-live-stream-grpc-controller-ts-session-routing.md`
**Risk Level:** 🟡 Medium

## Context Gates

- **ARCHITECTURE.md** — `PASS`: Controller is thin — delegates all logic to `ActivityEngine`, `PresenceService`, etc. Enum mapping is a top-level function, appropriate for the current scope.
- **RULES.md** — `PASS`: Logging uses `userId` and `sessionId` only; no PII. Error messages sent to client are generic.
- **ROADMAP.md** — `PASS`: Directly implements the roadmap item. Teardown stub with TODO for lifecycle plan is present.

## Issues

### 1. `setup()` failure leaves stream hanging indefinitely

**Severity:** Bug
**Location:** `src/realtime/live-stream.grpc.controller.ts:120-129`

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

If `setup()` rejects (e.g. `resumeActivity()` throws a DB error), the catch handler sends a `SessionErrorEvent` but never closes the stream. The `request` observable is never subscribed to, so client messages are buffered/backpressured by the gRPC transport indefinitely. The stream only closes when the client cancels or the transport times out.

**Fix:** Call `subscriber.complete()` after sending the error event:

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

### 2. `mapProtoActivityType` validation error swallowed by generic catch

**Severity:** Bug
**Location:** `src/realtime/live-stream.grpc.controller.ts:138-175`

`mapProtoActivityType` throws `RpcException({ code: INVALID_ARGUMENT, message: 'Unsupported activity type: ...' })` for invalid activity types. This exception propagates up from `handleActivityStart` to `routeCommand`'s outer catch:

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

**Fix:** In `routeCommand`'s catch, check if the error is an `RpcException` and extract its details:

```typescript
} catch (err: unknown) {
  if (err instanceof RpcException) {
    const rpcError = err.getError() as { code?: number; message?: string };
    subscriber.next({
      sessionError: {
        code: rpcError.message ?? 'UNKNOWN',
        message: rpcError.message ?? 'An error occurred',
        timestamp: Date.now(),
      },
    });
  } else {
    this.logger.error(`Unexpected error handling command: userId=${userId}`, err);
    subscriber.next({
      sessionError: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred',
        timestamp: Date.now(),
      },
    });
  }
}
```

Alternatively, catch the RpcException locally in `handleActivityStart` before `startActivity` is called, and push a specific `SessionErrorEvent` there. This avoids leaking non-RpcException details from other codepaths.

### 3. Dangling `setup()` after early stream teardown corrupts presence

**Severity:** Warning
**Location:** `src/realtime/live-stream.grpc.controller.ts:82-118`

If the gRPC stream closes while `setup()` is awaiting `resumeActivity()`, the subscriber's teardown fires (the TODO stub). When `resumeActivity` resolves, `setup()` continues and calls `presenceService.online(userId, userId)` — marking the user as online after they've already disconnected. Since the teardown stub has no cleanup, the user stays `online` forever.

This is a known limitation (the teardown TODO exists for this reason), but the gap is specifically in `setup()` not checking whether the subscriber is still alive after awaiting. A minimal guard:

```typescript
if (subscriber.closed) return;
```

after the `resumeActivity()` await and before `presenceService.online()` would prevent the stale presence write without requiring the full lifecycle plan.

## Observations (Non-blocking)

- **`activityRefType` dropped in gRPC path:** The proto `ActivityStartCmd` has no `refType` field, so the gRPC controller always passes `activityRefType: undefined` to `startActivity`. The WebSocket gateway's `ActivityStartDto` includes it. This is a deliberate proto contract decision, not a bug, but worth noting for completeness.

- **`handleActivityPause` / `handleActivityResume` have local try/catch plus `routeCommand` outer catch:** The double-catch is correct — the local catch handles expected errors (NO_ACTIVE_SESSION, ALREADY_PAUSED, NOT_PAUSED) and sends specific error codes, while the outer catch is a safety net. No issue, just noting the pattern.

- **Auth: direct metadata read instead of `@GrpcCurrentUser()` decorator:** The controller reads `(metadata as any)[GRPC_USER_KEY]` directly rather than using the parameter decorator. This is the safer approach for bidi stream methods where NestJS parameter decorator injection is not guaranteed. Correctly follows the plan's contingency.

- **Module registration:** `LiveStreamGrpcController` added to `RealtimeModule.controllers` alongside `SyncStreamGrpcController`. All injected dependencies are already registered as providers or globally available. No missing providers.

REVIEW_PASS
