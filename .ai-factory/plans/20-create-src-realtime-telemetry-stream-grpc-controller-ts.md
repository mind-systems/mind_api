# Plan: Create telemetry-stream.grpc.controller.ts

## Context
Implement the `TelemetryService.StreamTelemetry` bidi-streaming gRPC controller that receives `TelemetryData` messages from the client, pushes each sample into `StreamEngine`, and streams back `TelemetryResponse` messages containing `TelemetryAck` (with `receivedCount`, `droppedCount`, `maxSamplesPerSecond`) or `SessionErrorEvent` on errors.

## Settings
- Testing: no
- Logging: minimal (errors and key outcomes only, per RULES.md)
- Docs: no

## Tasks

### Phase 1: Controller implementation

- [x] **Task 1: Create `src/realtime/telemetry-stream.grpc.controller.ts`**
  Files: `src/realtime/telemetry-stream.grpc.controller.ts`

  Create a new gRPC controller following the exact pattern of `live-stream.grpc.controller.ts`:

  **Class setup:**
  - `@Controller()`, `@UseFilters(GrpcExceptionFilter)`, `@UseInterceptors(GrpcAuthInterceptor)`, `@TelemetryServiceControllerMethods()` class decorators.
  - Implement `TelemetryServiceController` interface (from `proto/generated/telemetry`).
  - Inject `StreamEngine` and `ActivityEngine`.

  **`streamTelemetry(request: Observable<TelemetryData>, metadata?: Metadata): Observable<TelemetryResponse>` method:**
  - Return `new Observable<TelemetryResponse>((subscriber) => { ... })`.
  - Extract user from `metadata` via `GRPC_USER_KEY` symbol (same manual pattern as `LiveStreamGrpcController` — param decorators don't work for bidi stream methods).
  - If no user, call `subscriber.error(new RpcException({ code: UNAUTHENTICATED }))` and return.

  **Client message handling** (inside the Observable):
  - Subscribe to `request` Observable.
  - For each incoming `TelemetryData` message:
    1. Validate `msg.sessionId` is non-empty — if empty, send a `TelemetryResponse` with `error: { code: 'INVALID_ARGUMENT', message: 'Missing sessionId', timestamp: Date.now() }` and skip.
    2. Verify the session belongs to this user via `ActivityEngine.getActiveSession(userId)` — if no active session or `sessionId` doesn't match, send `error` with code `'NO_SESSION'` or `'SESSION_MISMATCH'`.
    3. **Paused-session check** — if the session is paused (`session.isPaused`) and `msg.instructionType === 'breath_phase'`, send `error: { code: 'SESSION_PAUSED', message: 'Cannot accept breath_phase samples while paused', timestamp: Date.now() }` and skip. This mirrors the existing `TelemetryGateway` behavior (lines 110-116) where `BREATH_PHASE` samples are rejected during pause. The proto model uses the `instructionType` field (value `'breath_phase'`) as the equivalent of the Socket.io `dto.data.dataType === StreamDataType.BREATH_PHASE` check. Import `StreamDataType` from `../constants/stream-data-types` and compare against `StreamDataType.BREATH_PHASE`.
    4. Push the sample with **all proto payload fields** to preserve module identity:
       ```typescript
       this.streamEngine.push(msg.sessionId, {
         timestamp: msg.timestamp,
         moduleId: msg.moduleId,
         instructionType: msg.instructionType,
         data: msg.data,
       })
       ```
       `TelemetrySample` extends `Record<string, unknown>`, so `moduleId` and `instructionType` are accepted as extra keys. These fields are critical — without them, flushed `session_stream_samples` rows lose their module identity and instruction type, making them useless for downstream analysis.
    5. Build and send a `TelemetryResponse` with `ack`:
       ```typescript
       {
         ack: {
           sessionId: msg.sessionId,
           receivedCount: result.totalReceived,
           droppedCount: result.droppedCount,
           maxSamplesPerSecond: streamEngine.maxSamplesPerSecond,
           timestamp: Date.now(),
         }
       }
       ```
    6. If `result.accepted === false`, log a warning (sample dropped).
  - On `request` error: propagate to `subscriber.error(err)`.
  - On `request` complete: call `subscriber.complete()`.

  **Teardown** (via `subscriber.add(() => { ... })`):
  - Unsubscribe from the client request subscription.
  - Log disconnect with userId.

  **Error handling style:**
  - Non-fatal errors (validation, missing session, paused session) are sent as `TelemetryResponse.error` on the stream — never via `subscriber.error()`, which would kill the stream.
  - Wrap the per-message handler in try/catch; on unexpected errors send `error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred', timestamp: Date.now() }`.

- [x] **Task 2: Register controller in `RealtimeModule`**
  Files: `src/realtime/realtime.module.ts`

  - Import `TelemetryStreamGrpcController` from `./telemetry-stream.grpc.controller`.
  - Add it to the `controllers` array alongside the existing `SyncStreamGrpcController` and `LiveStreamGrpcController`.
  - No new providers needed — `StreamEngine` and `ActivityEngine` are already provided in the module.
