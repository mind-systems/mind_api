# Plan: ModuleBiometricStreamGrpcController

## Context
Add the bidi gRPC controller that ingests `BioSampleBatch` messages, runs the 7-step validation chain, delegates accepted batches to `BiometricStreamEngine.pushBatch`, and emits `BioStreamResponse` ack/error envelopes — mirroring the instruction-stream controller's shape but adapted to batched biometric semantics.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Controller implementation

- [x] **Task 1: Create `module-biometric-stream.grpc.controller.ts` skeleton**
  Files: `src/realtime/module-biometric-stream.grpc.controller.ts`
  Create a new file with the class shell:
  - `@Controller()`, `@UseFilters(GrpcExceptionFilter)`, `@UseInterceptors(GrpcAuthInterceptor)`, `@ModuleBiometricStreamServiceControllerMethods()`.
  - Class `ModuleBiometricStreamGrpcController implements ModuleBiometricStreamServiceController`.
  - Private `logger = new Logger(ModuleBiometricStreamGrpcController.name)`.
  - Constructor injects **exactly three** providers — `BiometricStreamEngine` (do not copy `StreamEngine`), `ActivityEngine`, and the existing shared `ActiveStreamRegistry` (no new bio-only registry).
  - Imports: `Controller`, `Logger`, `UseFilters`, `UseInterceptors` from `@nestjs/common`; `Payload`, `RpcException` from `@nestjs/microservices`; `status as GrpcStatus` from `@grpc/grpc-js`; `Observable` from `rxjs`; `BioSampleBatch`, `BioStreamResponse`, `ModuleBiometricStreamServiceControllerMethods`, `ModuleBiometricStreamServiceController` from `../../proto/generated/module_biometric_stream`; `BiometricStreamEngine` from `./services/biometric-stream-engine.service`; `ActivityEngine` from `./services/activity-engine.service`; `ActiveStreamRegistry` from `./services/active-stream-registry.service`; `GrpcExceptionFilter`, `GrpcAuthInterceptor`, `GrpcCurrentUser` from the `../grpc/...` paths used by the instruction controller; `BioSampleInternal` from `./interfaces/bio-session-buffer.interface`; `JwtPayload` (type-only) from `../users/interfaces/auth.interface`.

- [x] **Task 2: Implement `streamData` method skeleton with auth + registry wiring** (depends on Task 1)
  Files: `src/realtime/module-biometric-stream.grpc.controller.ts`
  Implement `streamData(@Payload() request: Observable<BioSampleBatch>, @GrpcCurrentUser() user: JwtPayload | null): Observable<BioStreamResponse>`.
  - **MUST** use `@Payload()` on the request parameter (project rule: when any param uses `@GrpcCurrentUser()`, the request param is `undefined` at runtime without `@Payload()`).
  - Wrap the body in `new Observable<BioStreamResponse>((subscriber) => { ... })`.
  - If `!user` — `subscriber.error(new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' }))` and `return`.
  - Extract `const userId = user.sub`.
  - Call `this.activeStreamRegistry.register(userId, subscriber)`.
  - Subscribe to `request` with `{ next: (batch) => this.handleBatch(userId, batch, subscriber), error: (err) => subscriber.error(err), complete: () => subscriber.complete() }`.
  - On teardown (`subscriber.add(() => { ... })`): `this.activeStreamRegistry.deregister(userId, subscriber)`, `sub.unsubscribe()`, and `this.logger.log('Disconnected: userId=${userId}')` — same teardown shape as `module-instruction-stream.grpc.controller.ts:150-154`.
  - No per-controller `@OnEvent(AuthEvents.SESSION_REVOKED)` handler — shared registry is closed via `ModuleStateGrpcController.handleSessionRevoked`.

- [x] **Task 3: Implement `handleBatch` private method with the 7-step validation chain** (depends on Task 2)
  Files: `src/realtime/module-biometric-stream.grpc.controller.ts`
  Add `private handleBatch(userId: string, batch: BioSampleBatch, subscriber: Subscriber<BioStreamResponse>): void`.
  Wrap the whole body in `try { ... } catch (err: unknown) { ... }` — on unexpected throw, log `this.logger.error('Unexpected error handling bio batch: userId=${userId}', err)` and emit `subscriber.next({ error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred', timestamp: Date.now() } })`.
  Helper: define a local `const emitError = (code: string, message: string) => subscriber.next({ error: { code, message, timestamp: Date.now() } })` to keep the chain compact.
  Run the checks in this **exact order**, returning after the first failure (no partial accept of the batch):

  1. `batch.samples.length === 0` → `emitError('INVALID_ARGUMENT', 'Empty batch')`, return.
  2. `batch.samples[0].sessionId === ''` → `emitError('INVALID_ARGUMENT', 'Missing sessionId')`, return.
  3. Any `samples[i].sessionId !== samples[0].sessionId` (`batch.samples.some(...)`) → `emitError('INVALID_ARGUMENT', 'Inconsistent sessionId in batch')`, return.
  4. Any `samples[i].sampleType === ''` (`batch.samples.some(s => s.sampleType === '')`) → `emitError('INVALID_ARGUMENT', 'Missing sampleType')`, return.
  5. `const session = this.activityEngine.getActiveSession(userId); if (!session)` → `emitError('NO_SESSION', 'No active session found')`, return.
  6. `session.sessionId !== batch.samples[0].sessionId` → `emitError('SESSION_MISMATCH', 'Session ID does not match active session')`, return.
  7. `session.isPaused === true` → `emitError('SESSION_PAUSED', 'Cannot accept biometric samples while paused')`, return.

  Order rationale (mirror in code comments only if it aids reading): step 2 must precede step 3 so an all-empty batch surfaces "Missing sessionId" instead of a downstream mismatch; steps 5–7 must follow the structural ones so a malformed batch never hits `ActivityEngine`. Pause drops the whole batch (unlike instruction stream's per-type filter) because every biometric sample is user-produced data and mobile note 26 §7 contractually guarantees no client production during pause.

- [x] **Task 4: Implement the happy path — map samples, push batch, emit ack, warn-log on per-call drops** (depends on Task 3)
  Files: `src/realtime/module-biometric-stream.grpc.controller.ts`
  After all 7 validation steps pass, in the same `handleBatch` body:
  - Capture `const batchSessionId = batch.samples[0].sessionId`.
  - Map: `const mapped: BioSampleInternal[] = batch.samples.map((s) => ({ timestamp: s.timestamp, sampleType: s.sampleType, data: s.data }))` — `s.timestamp` is already `number` under the current ts-proto config, no Long conversion needed.
  - `const result = this.streamEngine.pushBatch(batchSessionId, mapped)`.
  - Emit ack — **all five `BioStreamAck` proto fields must be populated** (skipping any breaks the contract silently):
    ```
    subscriber.next({
      ack: {
        sessionId: batchSessionId,
        receivedCount: result.totalReceived,                       // cumulative
        droppedCount:  result.totalDropped,                        // cumulative (matches proto comment)
        maxSamplesPerSecond: this.streamEngine.maxSamplesPerSecond,
        timestamp: Date.now(),
      },
    });
    ```
  - **Per-call** drop warn-log: `if (result.droppedCount > 0) this.logger.warn('Sample(s) dropped for sessionId=${batchSessionId} userId=${userId}: buffer cap reached')` — fires on the per-call `droppedCount` field (not cumulative), mirroring `module-instruction-stream.grpc.controller.ts:127-131`, so each batch that lost samples gets exactly one log line.

### Phase 2: Module registration

- [x] **Task 5: Register the controller in `RealtimeModule`** (depends on Task 4)
  Files: `src/realtime/realtime.module.ts`
  - Import `ModuleBiometricStreamGrpcController` from `./module-biometric-stream.grpc.controller`.
  - Add it to the `controllers` array alongside `SyncStreamGrpcController`, `ModuleStateGrpcController`, `ModuleInstructionStreamGrpcController`.
  - Do not add it to `providers` (it is a controller, not a provider). Do not create or register a new bio-specific `ActiveStreamRegistry` — the existing one is shared by design.

### Phase 3: Verification

- [x] **Task 6: Build check** (depends on Task 5)
  Files: —
  Run `npm run build` (or `npx tsc --noEmit`) and `npm run lint` to confirm the new controller and module wiring compile cleanly. Resolve any type errors against the regenerated proto stubs (`BioSampleBatch`, `BioStreamResponse`, `ModuleBiometricStreamServiceController`).

## Commit Plan
- **Commit 1** (after tasks 1–4): "Add ModuleBiometricStreamGrpcController with batched validation chain"
- **Commit 2** (after tasks 5–6): "Register biometric stream controller in RealtimeModule"

<!-- orchestrator-sessions
planner: d59b7cc1-e46a-4d2e-ac40-c31974d1aef2
elapsed: 812
implementer: 87c6119e-da3e-4bc8-9d3b-cf1bc52bcf87
-->
