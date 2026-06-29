# Test plan — immediate persistence of discrete markers (silent-bug-first, TDD)

**Date:** 2026-06-29
**Source:** conversation context

Covers feature task [[25-persist-ispaused]]. Written **before** the feature: committed RED, turns GREEN when note 25 lands.

## Test authoring constraints
- **L1 — outcomes only:** assert the mock-visible `sampleRepo.save` / `sampleRepo.create` calls and their arguments. Never inspect the engine's private `buffers` map.
- **L2 — compile-now:** `push` already exists and is unchanged in signature; the branch is internal. Marker samples are plain objects — no new symbol needed beyond `StreamDataType.SESSION_EVENT` (`constants/stream-data-types.ts`, value `'session_event'`), which already exists.
- **L3 — label by spec name:** target cases `RED until spec 25-persist-ispaused`.
- **L4 — escalation valve:** the batch path (buffer + flush) is characterization. A RED there after note 25 = regression, escalate.

## Why this area (silent-failure filter)
Discrete `SESSION_EVENT` markers (start/stop/end/abandon/interrupt/pause/resume, plus disconnect/reconnect) are pushed into the same in-memory buffer as continuous `breath_phase` samples and persist only on the periodic `flushAll`. A crash before the timer **silently loses** any unflushed marker — corrupting the timeline and the restart-derive ([[26-state-rehydration]]) with no error. The fix routes markers to an immediate write; the high-volume stream stays batched.

## Behavior under change — think before writing
The discriminator is `sample.data?.dataType === StreamDataType.SESSION_EVENT`. **Only** marker samples set `data.dataType`; `breath_phase` samples carry the raw payload in `data` (no `dataType`), and the committed spec's `makeSample` uses a string `data` (`'x'`) — both fall through to the buffer. So the immediate-write path is exercised **only** by a sample whose `data` is `{ dataType: 'session_event', event }`.

## Red/Green contract
- **Target (RED until [[25-persist-ispaused]]):** a `SESSION_EVENT` `push` writes immediately; a non-marker `push` does not.
- **Characterization (GREEN, stay GREEN):** non-marker samples buffer and persist only on `flush`; byte-cap/overflow `droppedCount` accounting; `flush`/`flushAll` batch save.

## Instantiation
Drive the **real** `StreamEngine` — `new StreamEngine(sampleRepo, moduleSessionRepo, configService)` (3 ctor args, `stream-engine.service.ts:39-44`), with `sampleRepo` a mocked `Repository<SessionStreamSample>` (`create`/`save` spies, `save.mockResolvedValue({})`), `moduleSessionRepo` mocked (`update` spy), `configService` returning the default caps. `push` is the system under test; assert on `sampleRepo`.

## Test cases
### Immediate marker write (target → 25)
- `push(sid, { timestamp, data: { dataType: StreamDataType.SESSION_EVENT, event: 'paused' } })` calls `sampleRepo.save` **synchronously** (the fire-and-forget `save()` invocation happens inside `push`), with a one-element row — assert `sampleRepo.create` was called with `{ moduleSessionId: sid, samples: [<the marker sample>], flushedAt: <Date> }`. RED now (push only buffers, no save) → GREEN after.
- Two distinct markers `push`ed → two immediate `sampleRepo.save` calls (each a one-element row), **not** one batched row.
### Continuous stream still batches (characterization / contrast)
- `push(sid, { timestamp, moduleId, instructionType: 'breath_phase', data: { phase: 'exhale' } })` (no `data.dataType`) does **not** call `sampleRepo.save` — it buffers; `save` fires only on a subsequent `flush(sid)`. RED-safe both now and after (the value is the contrast).
- The committed `makeSample` (`{ timestamp, data: 'x' }`) path is unchanged: buffered, saved on flush.
### Unchanged (characterization)
- `flush(sid)` / `flushAll` still save the buffered batch as one row (existing cases); the per-sample byte-cap still returns `accepted:false`/`droppedCount:1` on overflow; `doFlush`'s fire-and-forget `moduleSessionRepo.update(lastActivityAt)` is untouched.

## Anti-targets (enumerated by file:line)
- **None.** Scanned `stream-engine.service.spec.ts`: every committed `push`-then-assert case uses `makeSample` (`{ timestamp, data: 'x' }`, a string `data` with no `dataType`), so under the new branch those samples still buffer — the "saves batch to DB and clears buffer" (`:118-138`), "flushes all buffered sessions" (`:175-`), and overflow cases all stay GREEN. No committed case asserts a `SESSION_EVENT` sample is buffered, so there is nothing to invert.

## Gotchas
- The immediate write is **fire-and-forget** inside `push` (`void sampleRepo.save(...).catch(...)`) so `push` stays synchronous — the `save()` *call* is synchronous; assert `toHaveBeenCalled` right after `push` (no `await`, no fake-timer advance needed). Only the promise resolution is async.
- Assert the immediate row is a **one-element** `samples` array (`[sample]`) keyed by the pushed `sid` — this distinguishes the marker write from a batch flush.
- Do not assert `push`'s return value changed — its `PushResult` shape is unchanged (markers ignore it).

## Findings / escalation to note 25
1. Branch in `push` on `sample.data?.dataType === SESSION_EVENT` → immediate one-row `sampleRepo.save`; else buffer as today.
2. Keep `push` synchronous (fire-and-forget save) and its signature/return unchanged — no client/proto change.
