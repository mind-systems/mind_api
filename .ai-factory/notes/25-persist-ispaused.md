# Persist discrete session-event markers immediately

**Date:** 2026-06-29
**Source:** conversation context

## Key Findings

- `StreamEngine.push` buffers **every** sample — discrete `SESSION_EVENT` markers and continuous `breath_phase` instruction samples alike — and persists only on the periodic `flushAll` (`setInterval`). A crash before the timer fires **silently loses** any buffered marker.
- Discrete markers (`STARTED/ENDED/ABANDONED/INTERRUPTED/PAUSED/RESUMED`, plus `DISCONNECTED/RECONNECTED` from [[23-connection-loss-markers]]) are **rare and load-bearing** — the timeline's structure and the restart-derive depend on them. They must be durable the instant they emit. The continuous streams are high-volume and stay batched.
- The split is done **inside `push`**, branching on the sample kind — no rename, no new public method, no client/proto change, no blocking. This generalizes (and replaces) the pause-specific flush from the previous design round.

## Details

### Current state
- `StreamEngine` ctor: `(sampleRepo: Repository<SessionStreamSample>, moduleSessionRepo: Repository<ModuleSession>, configService)` (`stream-engine.service.ts:39-44`).
- `push(sessionId, sample): PushResult` (`:83`) is **synchronous** — appends to an in-memory `buffers` map after a byte-cap check. Durability is via `doFlush(sessionId)` (`:130`), which does `sampleRepo.save(sampleRepo.create({ moduleSessionId: sessionId, samples, flushedAt: now }))`, called by the periodic `flushAll` and on lifecycle events.
- The 7 marker emitters in `activity-engine.service.ts` (the `this.streamEngine.push(...)` calls at `:150, :227, :301, :350, :421, :474, :515` against HEAD) all call `push(sid, { timestamp, data: { dataType: StreamDataType.SESSION_EVENT, event } })`.
- The continuous instruction stream (`module-instruction-stream.grpc.controller.ts`) calls `push(sid, { timestamp, moduleId, instructionType, data })` where `data` is the raw payload — it carries **no** `data.dataType`.
- `StreamDataType` (`constants/stream-data-types.ts`) = `{ SESSION_EVENT: 'session_event', BREATH_PHASE: 'breath_phase' }`. Only the marker samples set `data.dataType`.

### Change (approach A — branch inside `push`, no API change)
In `StreamEngine.push`, before the buffer logic, branch:
- **`sample.data?.dataType === StreamDataType.SESSION_EVENT`** → **persist immediately**: `void this.sampleRepo.save(this.sampleRepo.create({ moduleSessionId: sessionId, samples: [sample], flushedAt: new Date() })).catch(err => this.logger.error(...))`. Fire-and-forget (not awaited) so `push` stays **synchronous** and off the client path. Do not buffer it; skip the byte-cap (markers are tiny). Return a success `PushResult` (`{ accepted: true, droppedCount: 0, totalReceived: ... }`) — callers ignore it for markers.
- **else** (continuous `breath_phase`, whose `data` has no `dataType`; and any sample without a `SESSION_EVENT` discriminator) → buffer + periodic flush **exactly as today** (byte-cap, `buffers` map, `flushAll`).

The 7 marker emitters and the instruction controller are **unchanged** — they already call `push`; the engine now routes markers to an immediate write.

### Inlined contracts
- `session_stream_samples(moduleSessionId uuid, samples jsonb, flushedAt)` (`session-stream-sample.entity.ts`, `@Index(['moduleSessionId'])`). A marker is written as a one-element `samples` array — markers and batched instruction rows coexist under the same `moduleSessionId`; the existing read merges all rows by timestamp, unchanged.
- `push` signature and return type are **unchanged** (`push(sessionId, sample): PushResult`) — committed `push(...)` assertions stay valid.
- Discriminator is `sample.data?.dataType === SESSION_EVENT`. Continuous `breath_phase` samples carry the raw payload in `data` (no `dataType`) and fall through to the buffer — so the high-volume path is untouched.

### Guards / gotchas
- **No client/proto change, no blocking.** The client fires commands and never waits for ack; the immediate write is fire-and-forget server-internal — the command handlers' client-facing behavior is identical.
- **No `module_sessions` pause column** (decision B). Pause durability falls out of this for free (the `PAUSED`/`RESUMED` markers are `SESSION_EVENT`), and [[26-state-rehydration]] derives `isPaused` from them.
- `breath_phase` batching, the byte-cap, and overflow `droppedCount` accounting are untouched — only `SESSION_EVENT` samples divert.
- Committed `stream-engine.service.spec.ts` uses `makeSample` whose `data` is a string (`'x'`) — `data.dataType` is `undefined`, so those samples buffer as before; the batch cases stay GREEN (not anti-targets).

### Verify
- Pause (or start) a session → kill the process immediately (SIGKILL, no graceful flush) → the marker is already a row in `session_stream_samples` (it did not wait on the periodic timer). A `breath_phase` pushed just before the kill is still lost to the buffer (expected — continuous data stays batched).

## Open Questions
- None.
