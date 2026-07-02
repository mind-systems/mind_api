# Code Review 3: Persist discrete markers immediately; batch only continuous streams

**Plan:** `36-persist-discrete-markers-immediately-batch-only-continuous-streams.md`
**Changed source:** `stream-engine.service.ts`, `activity-engine.service.ts`, `interfaces/session-buffer.interface.ts`, `stream-engine.service.spec.ts`
**Verification:**
- `npx jest stream-engine.service.spec.ts` → 22/22 pass (spec-25 immediate-marker cases green).
- `npx tsc --noEmit` → clean (the only errors are 3 pre-existing ones in `biometric-stream-engine.service.spec.ts`, confirmed present on HEAD with the change stashed — unrelated).
- `activity-engine.service.spec.ts` → 5 failures, all labeled *"RED until spec 23-connection-loss-markers"* / *"RED until spec 24-pause-state-integrity"*; confirmed identically RED on HEAD with this change stashed. They test unimplemented future-milestone behavior and are not regressions from this change.

## What changed since review-2

The discriminator was reworked to close review-2's finding. The internal `InstructionSample` gains an optional `serverMarker?: true`; a new private `ActivityEngine.pushSessionEventMarker(sessionId, event)` sets it, and all 7 SESSION_EVENT emitters (STARTED, ENDED, ABANDONED ×2, INTERRUPTED, PAUSED, RESUMED) were refactored to call it. `StreamEngine.push` now gates the immediate-persist branch on `sample.serverMarker === true && sample.data?.dataType === SESSION_EVENT`.

## Findings resolved from prior rounds

- **Review-1 / Review-2 — client can route samples around the byte-cap.** Resolved robustly. The discriminator no longer infers server-origin from the *absence* of client fields (which deserialize to `undefined` under this transport's `defaults:false` loader — the review-2 defect). It now requires an affirmative top-level `serverMarker: true`. The gRPC controller constructs its sample as `{ timestamp, moduleId, instructionType, data }` (`module-instruction-stream.grpc.controller.ts:94-99`) and never sets `serverMarker`; because `serverMarker` is a top-level sibling of the client-controlled `data` Struct (not nested inside it), a client cannot inject it through the wire. A forged `data.serverMarker` would not be read. Confirmed the byte-cap / `maxSessions` bypass is now unreachable from the client path. ✅
- **Review-1 — `lastActivityAt` liveness divergence.** Resolved: the marker branch fires `moduleSessionRepo.update({ id }, { lastActivityAt: now })` with the same fire-and-forget pattern as `doFlush`, sharing a single `now`. ✅

## Correctness checks (no defects found)

- **All marker emitters converted.** Every `SESSION_EVENT` push in `activity-engine.service.ts` now flows through `pushSessionEventMarker`; no direct `streamEngine.push({ data: { dataType: SESSION_EVENT } })` call remains, so no marker silently falls to the buffer and loses immediate durability.
- **Terminal-marker ordering is safe.** For ENDED/ABANDONED/INTERRUPTED the emitter first `repo.save`s the session (status/endedAt) and then the marker branch issues a separate `update` touching only `lastActivityAt`; it cannot resurrect a terminated row, and the watchdog only reaps `ACTIVE`/`DISCONNECTED`.
- **Type safety.** `serverMarker?: true` literal type matches the emitter's `serverMarker: true`; the narrow `as { dataType?: string } | undefined` cast on `unknown` `data` reads safely. `tsc` clean.
- **Test alignment.** `makeMarkerSample` was updated to include `serverMarker: true`, matching the new discriminator; the `breath_phase` and string-`data` cases (no `serverMarker`) correctly buffer.
- **No migration / FK / read-path impact** (unchanged from prior rounds): reuses `session_stream_samples`; `moduleSessionId` is a plain indexed uuid; `listInstructions` re-sorts by each sample's `timestamp`.

## Non-blocking forward note (not a finding against this change)

When spec 23 implements `handleTransportDisconnect` / `handleReconnect`, its DISCONNECTED/RECONNECTED markers should be emitted via `pushSessionEventMarker` so they inherit `serverMarker: true` and the immediate-persist path. The currently-RED spec-23 assertions (`activity-engine.service.spec.ts:938,978`) check only `data.dataType`, not `serverMarker` — so a future implementation that pushed those markers directly would buffer them (losing immediate durability) without failing a test. That is a coverage gap for a future milestone, outside the scope of this change.

REVIEW_PASS
