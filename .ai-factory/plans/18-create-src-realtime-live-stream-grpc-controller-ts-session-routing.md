# Plan: Create `live-stream.grpc.controller.ts` (session routing)

## Context
Implement the `LiveSession` bidirectional gRPC RPC that replaces the Socket.IO `LiveGateway` command-handling logic. The controller receives a stream of `LiveRequest` messages (each carrying one `oneof` command), routes them to `ActivityEngine` / `PresenceService`, and pushes `SessionStateEvent` / `SessionErrorEvent` responses back down the stream. On stream open, it detects reconnections via `StateStore.activityMap` and cancels the grace timer.

## Settings
- Testing: no
- Logging: minimal (errors and key business outcomes only, per RULES.md)
- Docs: no

## Tasks

### Phase 1: Enum mapping helpers

- [x] **Task 1: Create proto-to-internal enum mapping utility**
  Files: `src/realtime/live-stream.grpc.controller.ts` (private methods or top-level functions)
  Proto uses numeric enums (`ActivityType.BREATH = 1`, `PresenceState.FOREGROUND = 1`) while `ActivityEngine` / `PresenceService` use string enums (`ActivityType.BREATH = 'breath'`, status `'online'`/`'background'`). Create a mapping function:
  - `mapProtoActivityType(proto: ProtoActivityType): InternalActivityType` — maps `ProtoActivityType.BREATH` (1) to `InternalActivityType.BREATH` ('breath'); throws `RpcException(INVALID_ARGUMENT)` for `UNSPECIFIED` (0) / `UNRECOGNIZED` (-1).
  Keep this as a plain function at the top of the controller file (not a separate file). Follow the pattern used by existing gRPC controllers that import both proto and internal types.

  **Note:** `mapInternalStatusToProto` is intentionally omitted — within this plan's scope the controller always knows which proto `SessionStatus` to use based on the command that succeeded (e.g. `activityEnd` → `COMPLETED`), so an internal-to-proto status mapper would be dead code. It can be added in the lifecycle plan if needed.

### Phase 2: Controller skeleton and stream setup

- [x] **Task 2: Create `LiveStreamGrpcController` with `liveSession` bidi method** (depends on Task 1)
  Files: `src/realtime/live-stream.grpc.controller.ts`
  Create the controller class following the `SyncStreamGrpcController` pattern:
  - Decorate with `@Controller()`, `@UseFilters(GrpcExceptionFilter)`, `@UseInterceptors(GrpcAuthInterceptor)`.
  - Apply `@LiveServiceControllerMethods()` (from `proto/generated/live.ts`) to auto-register `@GrpcStreamMethod`.
  - Implement `LiveServiceController` interface — `liveSession(request: Observable<LiveRequest>): Observable<LiveResponse>`.
  - Inside `liveSession`, return `new Observable<LiveResponse>((subscriber) => { ... })`.
  - Auth check: if `@GrpcCurrentUser()` is `null`, emit `subscriber.error(new RpcException({ code: GrpcStatus.UNAUTHENTICATED }))` and return.
  - Inject: `StateStore`, `ActivityEngine`, `PresenceService`, `GraceTimerManager`, `RateLimiterService`, `ConfigService`.
  - Read rate-limit config from `ConfigService` in the constructor (same keys as `LiveGateway`: `RealtimeConfig.RATE_LIMIT_ACTIVITY_START_PER_MIN`, `RealtimeConfig.RATE_LIMIT_WINDOW_MS`).

  **Note on `@GrpcCurrentUser()` with bidi streams:** The `liveSession` method receives `Observable<LiveRequest>` as its first parameter. In NestJS gRPC bidi handlers, the second parameter is the gRPC `Metadata` context object — but `@GrpcCurrentUser()` is a `createParamDecorator` that reads from `ctx.switchToRpc().getContext()`. The interceptor stores the user on the metadata object before the handler runs. Verify that `@GrpcCurrentUser()` works as a second parameter on a bidi method; if NestJS doesn't inject it for stream methods, read the user directly from the metadata object passed as the second argument (same Symbol key `GRPC_USER_KEY` used by the decorator).

- [x] **Task 3: Implement reconnect detection on stream open and teardown stub** (depends on Task 2)
  Files: `src/realtime/live-stream.grpc.controller.ts`
  Inside the `Observable` body, before subscribing to the incoming request stream:
  - Check `stateStore.activityMap.has(userId)`.
  - If an entry exists (reconnect path): call `graceTimerManager.cancelTimer(userId)`, then `await activityEngine.resumeActivity(userId)`. If `resumeActivity` returns a session, push a `SessionStateEvent` with `liveSessionId: session.id, status: RESUMED, isPaused: false` via `subscriber.next(...)`.
  - Call `presenceService.online(userId, userId)` — use `userId` as the "socketId" placeholder since there is no socket in gRPC; `PresenceService.online` only uses it to store in the presence map entry.
  - Wrap the async reconnect logic in a `Promise` that runs before subscribing to the request observable. Catch errors and push `SessionErrorEvent` to the subscriber.

  **Teardown stub:** Following the `SyncStreamGrpcController` pattern (`subscriber.add(() => { ... })`), register a teardown callback at the end of the Observable body:
  ```typescript
  subscriber.add(() => {
    // TODO: lifecycle plan — onDisconnect, grace timer start, presence.offline, rateLimiter.evict
  });
  ```
  Without this, if the lifecycle plan is delayed, the deployed controller silently leaks in-memory state (presence stays `'online'` forever, no grace timer fires). The stub ensures the pattern is in place and makes the gap explicit.

### Phase 3: Command routing

- [x] **Task 4: Subscribe to incoming `LiveRequest` stream and route commands** (depends on Task 3)
  Files: `src/realtime/live-stream.grpc.controller.ts`
  Subscribe to the `request` observable inside the `Observable` body. For each `LiveRequest` message, inspect which `oneof` field is set and delegate:

  **`activityStart`:**
  - Rate-limit check: `rateLimiterService.consume(`activity-start:${userId}`, limit, windowMs)`. If rejected, push `SessionErrorEvent { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many activity:start requests', timestamp: Date.now() }`.
  - Check `activityEngine.getActiveSession(userId)`. If already active, push `SessionStateEvent { liveSessionId: existing.sessionId, status: ACTIVE }` (idempotent, mirrors `LiveGateway` behavior).
  - Otherwise call `activityEngine.startActivity(userId, { activityType: mapProtoActivityType(cmd.activityType), activityRefId: cmd.refId })`. Push `SessionStateEvent { liveSessionId: session.id, status: ACTIVE }`.

  **`activityEnd`:**
  - Call `activityEngine.endActivity(userId)`. If returns session, push `SessionStateEvent { liveSessionId: session.id, status: COMPLETED }`. If null (no session), silently ignore (matches gateway behavior).

  **`activityStop`:**
  - Call `activityEngine.stopActivity(userId)`. If returns session, push `SessionStateEvent { liveSessionId: session.id, status: INTERRUPTED }`. If null, silently ignore.

  **`activityPause`:**
  - Call `activityEngine.pauseActivity(userId)` in try/catch. On success push `SessionStateEvent { liveSessionId: state.sessionId, status: ACTIVE, isPaused: true }` (where `state` is the activity state from `stateStore.activityMap.get(userId)` — matches the gateway pattern of reading `sessionId` from the in-memory state rather than the engine return value). On error push `SessionErrorEvent` with the error message as the code (matches gateway: `WsErrorCode.NO_ACTIVE_SESSION` / `ALREADY_PAUSED`).

  **`activityResume`:**
  - Call `activityEngine.unpauseActivity(userId)` in try/catch. On success push `SessionStateEvent { liveSessionId: state.sessionId, status: ACTIVE, isPaused: false }` (same `state.sessionId` pattern as pause). On error push `SessionErrorEvent`.

  **`presence`:**
  - If `cmd.state === PresenceState.FOREGROUND`, call `presenceService.foreground(userId)`.
  - If `cmd.state === PresenceState.BACKGROUND`, call `presenceService.background(userId)`.
  - If `cmd.state === PresenceState.PRESENCE_STATE_UNSPECIFIED` (0) or `UNRECOGNIZED` (-1), push `SessionErrorEvent { code: 'INVALID_PRESENCE_STATE', message: 'PresenceState must be FOREGROUND or BACKGROUND', timestamp: Date.now() }`. This is consistent with how `activityStart` validates `ActivityType` — both reject `UNSPECIFIED`/`UNRECOGNIZED` with an error rather than silently swallowing.
  - No response pushed for valid presence commands (fire-and-forget, matches gateway behavior).

  **No field set (empty message):**
  - Push `SessionErrorEvent { code: 'INVALID_COMMAND', message: 'Empty LiveRequest — no command set' }`.

  Wrap each command handler in try/catch. Unexpected errors should push `SessionErrorEvent` with `code: 'INTERNAL_ERROR'` and log the error (but not the user data per RULES.md).

### Phase 4: Registration

- [x] **Task 5: Register controller in `RealtimeModule`** (depends on Task 4)
  Files: `src/realtime/realtime.module.ts`
  Add `LiveStreamGrpcController` to the `controllers` array alongside `SyncStreamGrpcController`. No new providers needed — all dependencies (`StateStore`, `ActivityEngine`, `PresenceService`, `GraceTimerManager`, `RateLimiterService`, `ConfigService`) are already registered as providers or are globally available.

## Commit Plan
- **Commit 1** (after tasks 1-3): "Add LiveStreamGrpcController skeleton with enum mapping, reconnect detection, and teardown stub"
- **Commit 2** (after tasks 4-5): "Implement command routing and register controller in RealtimeModule"
