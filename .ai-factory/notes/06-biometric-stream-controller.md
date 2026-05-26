# ModuleBiometricStreamGrpcController — Implementation Spec

**Date:** 2026-05-23
**Status:** decisions locked
**Parent doc:** `.ai-factory/notes/03-biometric-stream-service.md` (architectural decisions §4, §6)
**Mirror file:** `src/realtime/module-instruction-stream.grpc.controller.ts` (after Phase 17 refactor — uses `@GrpcCurrentUser()`)
**New file:** `src/realtime/module-biometric-stream.grpc.controller.ts`
**Prerequisite:** Phase 17 (instruction-stream controller refactored to `@GrpcCurrentUser()`) must be merged first, otherwise the new controller will be the second one to disagree with its peers.

## Class shape

```
@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
@ModuleBiometricStreamServiceControllerMethods()
export class ModuleBiometricStreamGrpcController
  implements ModuleBiometricStreamServiceController { … }
```

## DI

Constructor injects **exactly three** providers (do not copy `StreamEngine` from the instruction controller by accident):

- `private readonly streamEngine: BiometricStreamEngine`
- `private readonly activityEngine: ActivityEngine`
- `private readonly activeStreamRegistry: ActiveStreamRegistry`

The third is the **existing** shared registry, not a new bio-only one — see note 03 §6 for the rationale (session-revoke close comes for free).

## Method

```
streamData(
  request: Observable<BioSampleBatch>,
  @GrpcCurrentUser() user: JwtPayload | null,
): Observable<BioStreamResponse>
```

Same Observable-wrapping shape as `module-instruction-stream.grpc.controller.ts:40-160`.

## Inside the subscriber

```
return new Observable<BioStreamResponse>((subscriber) => {
  if (!user) {
    subscriber.error(new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' }));
    return;
  }
  const userId = user.sub;
  this.activeStreamRegistry.register(userId, subscriber);

  const sub = request.subscribe({
    next: (batch) => this.handleBatch(userId, batch, subscriber),
    error: (err) => subscriber.error(err),
    complete: () => subscriber.complete(),
  });

  subscriber.add(() => {
    this.activeStreamRegistry.deregister(userId, subscriber);
    sub.unsubscribe();
    this.logger.log(`Disconnected: userId=${userId}`);
  });
});
```

## Validation chain (`handleBatch`)

Run in **this exact order**. Failing any one emits a single error envelope (`{error: {code, message, timestamp: Date.now()}}`) and skips persistence for the entire batch — no partial accept.

| # | Condition | Code | Message |
|---|---|---|---|
| 1 | `batch.samples.length === 0` | `INVALID_ARGUMENT` | `"Empty batch"` |
| 2 | `batch.samples[0].sessionId === ''` | `INVALID_ARGUMENT` | `"Missing sessionId"` |
| 3 | Any `samples[i].sessionId !== samples[0].sessionId` | `INVALID_ARGUMENT` | `"Inconsistent sessionId in batch"` |
| 4 | Any `samples[i].sampleType === ''` | `INVALID_ARGUMENT` | `"Missing sampleType"` |
| 5 | `activityEngine.getActiveSession(userId)` returns `undefined` | `NO_SESSION` | `"No active session found"` |
| 6 | `session.sessionId !== samples[0].sessionId` | `SESSION_MISMATCH` | `"Session ID does not match active session"` |
| 7 | `session.isPaused === true` | `SESSION_PAUSED` | `"Cannot accept biometric samples while paused"` |

**Why order matters:**
- Step 2 must precede step 3 — an all-empty batch passes consistency but then mismatches the active session, masking the real error class.
- Steps 5–7 must follow the structural ones — no point hitting `ActivityEngine` if the batch is malformed.

**Why pause drops the whole batch (vs instruction stream's per-type filter at lines 101-113):**
There, `BREATH_PHASE` is filtered but `session_event` passes — service-class samples are server-written and must always flow. Here, every biometric `sampleType` is pure user data; mobile note 26 §7 contractually guarantees the client never produces during pause. A batch arriving during pause is a client bug. Persisting fragments corrupts time-join analytics. If a future `sampleType` ever needs to bypass pause it must be added explicitly.

`activityEngine.getActiveSession` signature is `ActivityState | undefined` (`activity-engine.service.ts:312-314`); `if (!session)` covers it.

## Happy path (all checks pass)

```
const samples_mapped: BioSampleInternal[] = batch.samples.map((s) => ({
  timestamp: s.timestamp,    // ts-proto generates int64 as number — no Long conversion under current config
  sampleType: s.sampleType,
  data: s.data,
}));

const result = this.streamEngine.pushBatch(batch_session_id, samples_mapped);

subscriber.next({
  ack: {
    sessionId: batch_session_id,
    receivedCount: result.totalReceived,    // cumulative
    droppedCount:  result.totalDropped,     // cumulative — matches the proto comment
    maxSamplesPerSecond: this.streamEngine.maxSamplesPerSecond,
    timestamp: Date.now(),
  },
});

if (result.droppedCount > 0) {
  this.logger.warn(
    `Sample(s) dropped for sessionId=${batch_session_id} userId=${userId}: buffer cap reached`,
  );
}
```

The warn-log fires on **per-call** `droppedCount > 0` (mirror of `module-instruction-stream.grpc.controller.ts:132-136`) — not on cumulative, so each batch that lost samples gets one log line.

## Ack envelope completeness

`BioStreamAck` has five proto fields; **all five** must be populated. Skipping any (commonly `timestamp` or `sessionId`) breaks the contract silently.

| Field | Source |
|---|---|
| `sessionId` | `batch_session_id` (validated in step 6 above) |
| `receivedCount` | `result.totalReceived` (cumulative since session start) |
| `droppedCount` | `result.totalDropped` (cumulative since session start) |
| `maxSamplesPerSecond` | `this.streamEngine.maxSamplesPerSecond` |
| `timestamp` | `Date.now()` |

## Error envelope

```
subscriber.next({
  error: { code: '<CODE>', message: '<MESSAGE>', timestamp: Date.now() },
});
```

Same `StateErrorEvent` shape as the instruction stream — imported from `module_state.proto`.

## Session-revoke close

The shared `ActiveStreamRegistry` is closed by `ModuleStateGrpcController.handleSessionRevoked` (`module-state.grpc.controller.ts:165-176`). After Phase 18 lands (`SessionEvents.REVOKED` + flush on revoke), the biometric subscriber is gracefully flushed and then closed alongside the instruction one — no per-controller `@OnEvent(AuthEvents.SESSION_REVOKED)` handler needed here.

## Register

Add as a controller in `RealtimeModule.controllers`.
