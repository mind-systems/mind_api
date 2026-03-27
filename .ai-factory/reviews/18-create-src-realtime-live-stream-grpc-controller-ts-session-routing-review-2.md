## Code Review — Patch Verification

**Plan:** `18-create-src-realtime-live-stream-grpc-controller-ts-session-routing.md`
**Patch:** `18-create-src-realtime-live-stream-grpc-controller-ts-session-routing-patch-1.md`
**File:** `src/realtime/module-session.grpc.controller.ts`

### Context Gates

- **ARCHITECTURE.md** — `PASS`: Controller remains thin. All three fixes are local to the controller — no new service imports, no cross-module changes.
- **RULES.md** — `PASS`: No new logging. Error message at line 236 includes `cmd.activityType` (a numeric enum value, not PII). No non-null assertions added.
- **ROADMAP.md** — `PASS`: No scope change. Fixes address correctness of the existing session-routing implementation.

### Fix 1: `subscriber.complete()` after setup failure — line 130

Correct. When `setup()` rejects, the catch now sends the error event and closes the stream. The `subscriber.complete()` triggers the teardown callback (line 134). Teardown side effects are all safe on an uninitialized stream:

- `activeStreamRegistry.deregister()` — registered at line 82 before setup, so deregister is correct.
- `presenceService.offline()` — calls `presenceMap.delete(userId)` on a non-existent entry (online was never called) — Map delete on missing key is a no-op.
- `handleTransportDisconnect()` — checks `activitySessionStore.has(userId)` first — no-op if no session exists.
- `rateLimiterService.evict()` — evicting a non-existent key is a no-op.

No issues.

### Fix 2: Local try/catch for `mapProtoActivityType` — lines 229–241

Correct. The `mapProtoActivityType` exception is now caught locally in `handleActivityStart` before reaching the outer `routeCommand` catch. The client receives `code: 'INVALID_ACTIVITY_TYPE'` with a specific message instead of the generic `INTERNAL_ERROR`. Early return prevents `startActivity` from executing.

The outer `routeCommand` catch (line 185) remains as a pure safety net for unexpected errors — it will no longer be triggered by validation failures.

`mapProtoActivityType` still throws `RpcException` internally. This is harmless — the bare `catch` discards it. The function could be simplified to throw a plain `Error` in the future, but that's a style nit, not a correctness issue.

No issues.

### Fix 3: `subscriber.closed` guard — line 86

Correct. After `handleReconnect` resolves, the guard checks whether the stream was closed during the await. If closed, it returns early — preventing `presenceService.online()` from overwriting the teardown's `presenceService.offline()`, and avoiding a dead `request.subscribe()`.

Interaction with reconnect side effects: if `handleReconnect` already ran `cancelGraceTimer` and `resumeActivity` (setting session to ACTIVE), the teardown's `handleTransportDisconnect` will subsequently call `onDisconnect` (→ DISCONNECTED) and start a new grace timer. This is correct behavior — the user reconnected but immediately disconnected again, so the session correctly goes ACTIVE → DISCONNECTED → grace timer → ABANDONED.

No issues.

REVIEW_PASS
