# Code Review: Persist discrete markers immediately; batch only continuous streams

**Plan:** `36-persist-discrete-markers-immediately-batch-only-continuous-streams.md`
**Change under review:** `src/realtime/services/stream-engine.service.ts` (marker-branch added to `push`)
**Verification run:** `npx jest stream-engine.service.spec.ts` → 22/22 pass. `tsc --noEmit` clean for this file (3 pre-existing errors in `biometric-stream-engine.service.spec.ts` confirmed present on HEAD with the change stashed — unrelated to this diff).

## Summary

The implementation faithfully matches the plan and the committed RED tests: `push` now branches on `sample.data?.dataType === SESSION_EVENT`, persists a one-element row fire-and-forget (`void ... .catch(logger.error)`), skips the buffer/byte-cap, and returns a success `PushResult` reading `totalReceived` from an existing buffer or `0`. Signature, return type, emitters, entity, proto, and the continuous `breath_phase` path are untouched, exactly as specified. The row shape mirrors `doFlush`. No migration needed. The core intended flow (server-emitted markers) is correct.

Two behavioral concerns are worth recording. Neither breaks the intended server-emitted flow, but both are genuine divergences introduced by the diff.

---

## Findings

### 1. (Medium) Client-controllable discriminator bypasses the only server-side backpressure

`ModuleInstructionStreamGrpcController.streamData` passes the client's raw `msg.data` straight into `push` (`module-instruction-stream.grpc.controller.ts:94-99`), and `data` is a free-form proto `Struct` (`{ [key: string]: any }`). The new marker branch keys solely on `sample.data.dataType`, so an authenticated client that stamps `data.dataType = "session_event"` on its instruction samples is routed to the immediate-persist branch — which by design **skips both the per-session byte-cap (`maxBufferBytes`, 200 KB default) and the `maxSessions` guard**, and issues **one DB `INSERT` per sample** instead of one batched write per ~5 s.

Failure scenario: a buggy or malicious client tags every sample with `dataType: "session_event"` and pushes at the advertised `maxSamplesPerSecond` (50/s default, not enforced server-side). Each sample becomes an unthrottled, unbounded `session_stream_samples` insert for that one session — write amplification with no `droppedCount` and no cap. Scope is limited to one authenticated user's own live session (the sample is rejected earlier unless `getSession(userId, sessionId)` resolves), so blast radius is contained, but this removes the sole server-side smoothing/backpressure for anything carrying the discriminator.

This was already flagged in `plan-review-1` as a concern to "accept and document, or guard." The implemented code does neither. Recommend one of:
- explicitly accept and document the residual risk (blast radius = one authenticated user's session), or
- gate the marker branch so only genuinely server-originated markers qualify (e.g. require the absence of the client-only `moduleId`/`instructionType` fields on the sample), since all 7 legitimate emitters push `{ timestamp, data }` with no `moduleId`/`instructionType`, whereas the client controller always sets both.

### 2. (Low) Immediate-marker path drops the `lastActivityAt` refresh that `doFlush` performed

The batched path bumps the DB row's `lastActivityAt` on every flush (`doFlush`, `stream-engine.service.ts:191-197`). The new immediate-marker branch persists the sample but does **not** update `moduleSessionRepo.lastActivityAt`. Before this change, pushing any marker refreshed the DB `lastActivityAt` on the next periodic flush; now markers never touch it.

`pauseActivity`/`unpauseActivity` set only the **in-memory** `state.lastActivityAt` (`activity-engine.service.ts:513,554`), never the DB column — so the DB refresh on pause/resume previously came *solely* from the marker's flush and is now gone. The session watchdog reaps `ACTIVE`/`DISCONNECTED` rows whose DB `lastActivityAt < now - maxIdleMs` (`session-watchdog.service.ts:65-72`).

Practical impact is small: the watchdog skips any user with a live subscriber (`hasLiveSubscriber`, line 80), and any session still producing continuous `breath_phase` samples keeps `lastActivityAt` fresh via `doFlush`. The regression only bites a session that is connected-but-quiet purposely emitting markers — an edge case. Flagging it because it is a silent divergence from the previously-batched behavior that the plan did not call out; if marker activity is intended to count as liveness, the marker branch should also fire the same fire-and-forget `lastActivityAt` update `doFlush` uses.

---

## Non-issues verified

- **Read/timeline ordering** — `SessionsService.listInstructions` re-sorts flattened samples by each sample's own `timestamp`, so writing markers as separate immediate rows (with `flushedAt ≈ event time`) does not disturb ordering.
- **Fire-and-forget ordering** — two synchronous marker pushes issue two `save` calls in order; even if the DB writes complete out of order, the read path sorts by `timestamp`, so it is immaterial.
- **`totalReceived` for markers** — reading `this.buffers.get(sessionId)?.totalReceived ?? 0` without creating a buffer is correct per the plan; callers ignore the marker return value.
- **Type cast** — narrow `as { dataType?: string } | undefined` on `unknown` `data` reads `undefined` safely for string/other payloads (no crash), matching the committed `makeSample` (string-data) test.
- **No FK / migration risk** — reuses the existing `session_stream_samples` entity/table; `moduleSessionId` is a plain indexed uuid (no FK); the `STARTED` marker is pushed only after the row is persisted.
