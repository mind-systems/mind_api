# Code Review: telemetry-stream.grpc.controller.ts

**Files Reviewed:** `src/realtime/telemetry-stream.grpc.controller.ts`, `src/realtime/realtime.module.ts`
**Risk Level:** 🟢 Low

## Context Gates

- **ARCHITECTURE.md** — `PASS` — Controller stays within `RealtimeModule`; depends only on `StreamEngine` and `ActivityEngine`, both provided in the same module. No cross-module boundary violations.
- **RULES.md** — `PASS` — Logging is minimal: one `warn` for dropped samples, one `error` for unexpected exceptions, one `log` for disconnect. No PII in log messages.
- **ROADMAP.md** — `PASS` — Task listed under Phase 3.3 as "Create `src/realtime/telemetry-stream.grpc.controller.ts`". Fully aligned.

## Critical Issues

None.

## Non-Critical Issues

None.

## Observations

**1. `droppedCount` is per-call, not cumulative**

The proto comment on `TelemetryAck.droppedCount` says "cumulative number of samples discarded", but `StreamEngine.push()` returns `droppedCount` as 0 or 1 per call — there's no cumulative drop counter in `SessionBuffer`. The controller passes this value through directly (line 109).

This is **not a regression** — the Socket.io `TelemetryGateway` behaves identically (`result.droppedCount` passed straight through). It's a pre-existing mismatch between the proto doc and the engine's capability. If cumulative tracking is needed later, the fix belongs in `StreamEngine`, not this controller.

## Verification

- **TypeScript compilation:** `npx tsc --noEmit` — clean, no errors.
- **Type compatibility:** `TelemetryServiceController` interface declares `streamTelemetry(request: Observable<TelemetryData>): Observable<TelemetryResponse>`. The implementation adds `metadata?: Metadata` as an optional second parameter — compatible in TypeScript. Same pattern as `LiveStreamGrpcController.liveSession()`.
- **`StreamEngine.push()` signature:** `push(sessionId: string, sample: TelemetrySample): PushResult`. `TelemetrySample extends Record<string, unknown>` with required `timestamp: number` and `data: unknown`. The call passes `{ timestamp, moduleId, instructionType, data }` — extra keys accepted by the index signature.
- **`ActivityEngine.getActiveSession()` return type:** `ActivityState | undefined` — correctly null-checked at line 65.
- **`ActivityState.isPaused`:** `boolean` — correctly used in paused-session check at line 87.
- **`SessionErrorEvent` shape:** `{ code: string; message: string; timestamp: number }` — all `error` responses match.
- **Auth pattern:** `GRPC_USER_KEY` symbol extraction from metadata matches `GrpcAuthInterceptor` (line 74 of interceptor) and `LiveStreamGrpcController` (line 70).
- **Module registration:** `TelemetryStreamGrpcController` added to `controllers` array. `StreamEngine` and `ActivityEngine` already in `providers`. No new providers needed.
- **Teardown:** `subscriber.add(() => { sub.unsubscribe(); ... })` correctly cleans up the request subscription on stream close.
- **Thread safety:** The `next` handler is fully synchronous (no `await`). Node.js single-threaded execution + RxJS sequential delivery = no race conditions within a stream.

## Positive Notes

- Plan review feedback fully addressed: `moduleId` and `instructionType` are now included in the `push()` call (lines 100-101), and the paused-session check is implemented (lines 87-96) using `StreamDataType.BREATH_PHASE` constant.
- Error handling is correct: validation/session/pause errors use `subscriber.next({ error })` (keeping the stream alive), while auth failure uses `subscriber.error()` (killing the stream). Matches both the live controller and gRPC best practices.
- The controller is lean — no unnecessary state, no rate limiter (appropriate since telemetry is already rate-limited by `StreamEngine`'s buffer/byte caps), no lifecycle management (that's the live controller's job).
- Consistent with the established gRPC controller pattern across the codebase.

REVIEW_PASS
