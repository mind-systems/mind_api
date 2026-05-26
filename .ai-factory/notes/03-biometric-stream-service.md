# Module Biometric Stream Service — Phase 19 Spec

**Date:** 2026-05-23
**Status:** decisions locked, ready to decompose
**Pairs with:** `mind_mobile/.ai-factory/notes/26-biometric-stream-architecture.md`

## Goal

Add a parallel gRPC stream for biometric samples produced on the client (heart rate, NFB band powers, emotion classifier outputs, future signals) while a module session is active. Stored alongside instructions so analytics can time-join on `(moduleSessionId, timestamp)`.

The architecture for biometric streaming was anticipated in `docs/realtime/instruction-model.md:71-83` ("Биометрическая шкала (будущее) … пойдут через отдельный gRPC-сервис и отдельную таблицу"). This phase builds it.

## What is NOT being built

- No source-typed columns. `data` is opaque jsonb — same shape as `session_stream_samples.samples`.
- No retry/redelivery for dropped samples. Best-effort, same as the instruction stream.
- No persistence outside an active `ModuleSession`. A sample arriving with no current session for the user is rejected.
- No new module folder. Everything lives in `src/realtime/` — biometric stream is the same architectural layer as instruction stream.
- No new auth pathway. Reuses `GrpcAuthInterceptor`.
- No per-sample-type validation. The server treats `data` as opaque; schema ownership belongs to the producer (mobile).

## Locked decisions

### 1. Separate service, separate table — generic transport

Two parallel streams, both generic:

- `ModuleInstructionStreamService` (exists) → `session_stream_samples` — what the app told the user to do.
- `ModuleBiometricStreamService` (new) → `bio_session_samples` — what the user's body responded with.

Same envelope shape, same buffering pattern, same backpressure mechanism, same `ActivityEngine.getActiveSession(userId)` validation. The split exists because:
- Different RPS profile (biometric is ~13 samples/sec sustained, instructions are <1/sec).
- Different retention strategies (biometric volume can grow fast).
- Different config knobs without coupling.

### 2. Proto envelope — `BioSample`

```
message BioSample {
  string session_id = 1;
  int64  timestamp  = 2;          // client unix-ms at sample production time, not batch-send time
  string sample_type = 3;         // free string: "cardio", "emotions", "nfb", ...
  google.protobuf.Struct data = 4;
}

message BioSampleBatch {
  repeated BioSample samples = 1;
}

message BioStreamResponse {
  oneof event {
    BioStreamAck ack = 1;
    StateErrorEvent error = 2;    // reused from module_state.proto
  }
}

message BioStreamAck {
  string session_id = 1;
  int64  received_count = 2;
  int64  dropped_count = 3;
  int32  max_samples_per_second = 4;
  int64  timestamp = 5;
}

service ModuleBiometricStreamService {
  rpc StreamData(stream BioSampleBatch) returns (stream BioStreamResponse);
}
```

Differences from `StreamSample`:

- **No `module_id` field.** `moduleSessionId` already implies the module via `module_sessions.activityType`; biometric data is not module-shaped anyway.
- **Batch envelope from day one.** Mobile sends `repeated BioSample samples = 1` every ~250 ms (vs one-sample-per-frame for instructions). Reduces bidi frame overhead at 13 samples/sec.
- **One ack per batch**, not per sample. `received_count` / `dropped_count` are cumulative for the bidi connection (same convention as `StreamAck`).

`StateErrorEvent` is reused from `module_state.proto` (it was deliberately made top-level for cross-proto import). No new error type.

### 3. Storage — `bio_session_samples`

Mirror of `session_stream_samples` exactly, **including column-naming style**. `session_stream_samples` (see `src/migrations/1774863293946-InitialSchema.ts:285-298`) uses quoted **camelCase** columns (`"moduleSessionId"`, `"flushedAt"`, `"createdAt"`) — not snake_case. The new table matches:

| Column (quoted) | Type | Notes |
|---|---|---|
| `"id"` | uuid PK | `uuid_generate_v4()` default, PK named `PK_bio_session_samples_id` |
| `"moduleSessionId"` | uuid FK → `"module_sessions"("id")` ON DELETE CASCADE | FK named `FK_bio_session_samples_moduleSessionId`, indexed |
| `"samples"` | jsonb | array of `{timestamp, sampleType, data}` — `sessionId` not duplicated inside |
| `"flushedAt"` | timestamp | when the batch was persisted |
| `"createdAt"` | timestamp | row insertion, default `now()` |

Index: `IDX_bio_session_samples_moduleSessionId` on `("moduleSessionId")`.

The camelCase convention lets the entity use `@Column({type: 'uuid'}) moduleSessionId` etc. **without** `name:` mapping. Phase 16's `bci_devices` table picked snake_case, so both styles now exist in the project — but within the realtime layer all tables stay uniform with the existing convention.

Each `samples[i]` object stores `{timestamp, sampleType, data}`. The redundant `sessionId` from `BioSample` is dropped at the engine layer when packing the buffer (already on the row via `moduleSessionId`).

### 4. Server behavior — validation order, pause, mismatch, no session

The controller runs the following checks **in this exact order** per incoming `BioSampleBatch`. Failing any one emits a single error envelope (`{error: {code, message, timestamp}}`) and skips persistence for the whole batch:

1. **`samples.length === 0`** → `INVALID_ARGUMENT` "Empty batch".
2. **`samples[0].sessionId === ''`** → `INVALID_ARGUMENT` "Missing sessionId". Must come *before* the consistency check — otherwise an all-empty batch passes step 3 by accident and then fails at `SESSION_MISMATCH`, masking the real error class.
3. **Any `samples[i].sessionId !== samples[0].sessionId`** → `INVALID_ARGUMENT` "Inconsistent sessionId in batch".
4. **Any `samples[i].sampleType === ''`** → `INVALID_ARGUMENT` "Missing sampleType". `sample_type` is a free string at the proto level, but a non-empty discriminator is required to make the persisted sample interpretable.
5. **`activityEngine.getActiveSession(userId)` returns null** → `NO_SESSION`.
6. **`session.sessionId !== batch.sessionId`** → `SESSION_MISMATCH`.
7. **`session.isPaused`** → `SESSION_PAUSED` "Cannot accept biometric samples while paused". Drop the whole batch.

**Buffer-overflow** (during `engine.pushBatch` after all checks pass): per-sample byte accounting, partial accept — first N samples fit into `WS_BIO_STREAM_MAX_BUFFER_BYTES`, the rest are dropped and counted into `droppedCount`. Same policy as `StreamEngine.push`. Not an error envelope — just a non-zero `droppedCount` in the ack. The controller emits a `warn` log on every batch with `droppedCount > 0` (mirroring `module-instruction-stream.grpc.controller.ts:132-136`) so production drops are visible in logs, not just in client-side acks.

#### Pause semantics — deliberately stricter than instruction stream

`ModuleInstructionStreamGrpcController:101-113` only blocks `instructionType === BREATH_PHASE` during pause; `session_event` samples are allowed because they are server-written lifecycle markers that must always pass.

The biometric stream blocks the **whole batch** on pause. Two reasons:

- All current biometric `sampleType` values (`cardio`, `emotions`, `nfb`) are pure data. None have a "service event" semantic that needs to bypass pause.
- Mobile note 26 §7 contractually states the client drops all biometric samples on pause and never sends service-class samples during pause. So a batch arriving during pause is either a client bug or a race during the pause→resume transition; either way, persisting fragments corrupts time-join analytics (a paused window flagged in `session_event` must mean zero biometric rows).

If a future `sampleType` needs to bypass pause, it gets added explicitly here — opt-in, not opt-out.

### 5. Buffering and flush — `BiometricStreamEngine`

Direct mirror of `StreamEngine` with different config keys and a batch-shaped API. Full implementation spec: `.ai-factory/notes/05-biometric-stream-engine.md`. Key points:

- One in-memory `BioSessionBuffer` per active `moduleSessionId`.
- Flush every `WS_BIO_STREAM_FLUSH_INTERVAL_MS` (default 5000) OR on session lifecycle event.
- Hooks: `@OnEvent(SessionEvents.COMPLETED | ABANDONED | INTERRUPTED | REVOKED)` → flush, then drop buffer. Four handlers — same three as `StreamEngine` plus `REVOKED` from Phase 18.
- `onApplicationShutdown` → `flushAll()`.
- Updates `module_sessions.lastActivityAt` on flush, same fire-and-forget pattern.

```
pushBatch(sessionId, samples[]) → { acceptedCount, droppedCount, totalReceived, totalDropped }
```

Per-sample byte accounting; partial accept (first N fit, rest dropped, `droppedCount` and `buffer.totalDropped` both incremented per dropped sample). `totalReceived` and `totalDropped` come straight from the buffer (cumulative since session start); `acceptedCount` and `droppedCount` are this-call counts. On flush, `samples` and `byteSize` are cleared but `totalReceived` and `totalDropped` are not reset — same lifecycle as `StreamEngine`'s `totalReceived`.

#### Why new buffer types instead of reusing `InstructionSample` / `SessionBuffer`

Two unrelated reasons:

**Shape.** `InstructionSample` (in `src/realtime/interfaces/session-buffer.interface.ts:1-4`) is actually declared as `{ timestamp: number; data: unknown } & Record<string, unknown>` — an open-shape index signature, not a closed type. `moduleId` and `instructionType` are smuggled through the index signature only at the controller layer (`module-instruction-stream.grpc.controller.ts:115-120`), with no compile-time guarantee on either side. The biometric path benefits from explicit closed fields matching the on-the-wire envelope exactly (`sampleType`, no `moduleId`).

**Cumulative drop tracking.** `SessionBuffer` carries `totalReceived` but no `totalDropped`. The instruction-stream controller's ack emits `result.droppedCount` from each `push()` call — a per-call counter, not the cumulative number the `StreamAck.dropped_count` proto comment promises ("cumulative number of samples discarded"). The biometric pipeline closes this gap: `BioSessionBuffer` adds `totalDropped: number`, the engine increments it on every drop, and the ack reads it directly. The ack's `dropped_count` then genuinely matches the cumulative contract.

Decoupling at the data layer also keeps the two pipelines free to evolve independently — neither has to drag the other through a shared interface change.

So introduce parallel types in `src/realtime/interfaces/bio-session-buffer.interface.ts`:

```
interface BioSampleInternal { timestamp: number; sampleType: string; data: unknown; }
interface BioSessionBuffer  { sessionId: string; samples: BioSampleInternal[]; byteSize: number; totalReceived: number; totalDropped: number; }
```

The two engines stay structurally identical but the two pipelines never share a data type — which is what we want, because their on-the-wire shapes are intentionally different.

### 6. Connection registry — reuse `ActiveStreamRegistry`

The new controller registers its subscriber in the **existing** `ActiveStreamRegistry` (`src/realtime/services/active-stream-registry.service.ts`), the same instance already shared by `ModuleInstructionStreamGrpcController` and `SyncStreamGrpcController`. No new registry class.

The registry's storage is `Map<userId, Set<Subscriber>>` — multiple subscribers per user are first-class, so the biometric stream coexists as an independent entry alongside the other two without "slot sharing." `deregister` only removes the caller's own subscriber.

The critical reason this is the right choice (rather than a parallel `ActiveBioStreamRegistry`): session-revoke. `ModuleStateGrpcController.handleSessionRevoked` (`src/realtime/module-state.grpc.controller.ts:165-176`) reacts to `AuthEvents.SESSION_REVOKED` by calling `activeStreamRegistry.closeAll(userId)`. Sharing the registry means the biometric subscriber is force-closed on logout for free — same path that already terminates the instruction and sync subscribers. A parallel registry would require a parallel `@OnEvent` handler somewhere, and forgetting that wire-up would leave the biometric stream hanging with a revoked token, silently receiving `NO_SESSION` forever and leaking a slot in `WS_BIO_STREAM_MAX_SESSIONS`. Single source of truth for "kill everything for this user" is the safer default.

### 7. Config — new `WS_BIO_*` keys

Add to `src/realtime/constants/realtime-config.ts`:

| Constant | Env var | Default | Notes |
|---|---|---|---|
| `BIO_STREAM_MAX_BUFFER_BYTES` | `WS_BIO_STREAM_MAX_BUFFER_BYTES` | `1048576` (1 MB) | larger than instructions (200 KB) — biometric is denser |
| `BIO_STREAM_MAX_SESSIONS` | `WS_BIO_STREAM_MAX_SESSIONS` | `1000` | mirror of `WS_STREAM_MAX_SESSIONS` |
| `BIO_BACKPRESSURE_SAMPLES_PER_SEC` | `WS_BIO_BACKPRESSURE_SAMPLES_PER_SEC` | `50` | combined rate across all sample types — 13/s sustained leaves 4× headroom |
| `BIO_STREAM_FLUSH_INTERVAL_MS` | `WS_BIO_STREAM_FLUSH_INTERVAL_MS` | `5000` | same as instructions |

Telemetry/rate-limit constants are reused from existing `WS_*` keys (no need to duplicate `WS_TELEMETRY_MAX_PAYLOAD_BYTES` etc.).

**Open question, non-blocking:** the 50/sec backpressure default is sized for 13/sec sustained from `neiry_kit/.ai-factory/notes/22-classifier-callback-rates-and-data-ranges.md`, but burst behaviour during calibration / classifier warmup is not measured. If drops appear in production, bump the default to `100`.

### 8. Module placement

Everything goes in `src/realtime/` and is registered in `RealtimeModule`:

- `src/realtime/entities/bio-session-sample.entity.ts`
- `src/realtime/interfaces/bio-session-buffer.interface.ts`
- `src/realtime/services/biometric-stream-engine.service.ts`
- `src/realtime/module-biometric-stream.grpc.controller.ts`

`RealtimeModule.imports` adds `BioSessionSample` to `TypeOrmModule.forFeature([...])`. `controllers` adds the new controller. `providers` adds `BiometricStreamEngine`. `ActiveStreamRegistry` is already a provider — no change.

No new module file. Biometric streaming and instruction streaming are the same architectural layer — separate Nest modules would only force re-exporting `ActivityEngine`/`ActivitySessionStore` to consume them, which buys nothing.

### 9. Docs updates

- `docs/realtime/instruction-model.md` — remove "(будущее)" caveat from the biometric-scale section; add a forward-pointer to a new biometric-stream doc.
- `docs/realtime/database.md` — add `bio_session_samples` table description alongside `session_stream_samples`.
- `docs/realtime/configuration.md` — add the four `WS_BIO_*` rows.
- `docs/realtime/overview.md` — mention `ModuleBiometricStreamService` as a peer of `ModuleInstructionStreamService` in the Transport Layer paragraph.
- new `docs/realtime/biometric-stream.md` — behavioral doc (Russian, per project doc style) describing what kinds of samples flow, when streaming is allowed, pause semantics, and the relationship to `ModuleSession`. **No file trees, no method tables — behavior only.**

## Tests (separate `ROADMAP_TESTS.md` work — not in this phase's milestones)

`BiometricStreamEngine` unit tests (mirror `stream-engine.service.spec.ts`), `ModuleBiometricStreamGrpcController` tests (mirror `module-instruction-stream` patterns). Logged here so they aren't forgotten when test coverage is added.

## Phase 17 prerequisite — `ModuleInstructionStreamGrpcController` user-injection cleanup

Before this work lands, `ModuleInstructionStreamGrpcController` (`src/realtime/module-instruction-stream.grpc.controller.ts:41-47`) must be migrated from the legacy `(metadata as any)[GRPC_USER_KEY]` pattern to the `@GrpcCurrentUser()` parameter decorator — the same refactor Phase 15 applied to `ModuleStateGrpcController`. Without it, the new biometric controller (which uses `@GrpcCurrentUser()` from day one) will be the third realtime gRPC controller in a row to disagree with one of its peers, and the parallel-structure motivation for "mirror of the instruction stream" stops being true at the line level.

That refactor is a standalone task (Phase 17 in the roadmap, single-task phase mirroring Phase 15), independent of everything else in this note.

## Session-revoke flush — handled in Phase 18

The earlier risk of buffer loss on `handleSessionRevoked` failure (if `stopActivity` throws → `SessionEvents.INTERRUPTED` not emitted → engines don't flush → `closeAll` terminates streams → data dies with the process) is fixed in **Phase 18** as a prerequisite. New event `SessionEvents.REVOKED` is added, `handleSessionRevoked` emits it unconditionally, and both `StreamEngine` and `BiometricStreamEngine` listen.

`BiometricStreamEngine` (this note, §5) therefore registers **four** lifecycle handlers from day one: `COMPLETED | ABANDONED | INTERRUPTED | REVOKED`. Full spec: `.ai-factory/notes/04-session-revoke-flush-fix.md`.

## Cross-reference

- Mobile-side architecture: `mind_mobile/.ai-factory/notes/26-biometric-stream-architecture.md`
- Rate measurements: `neiry_kit/.ai-factory/notes/22-classifier-callback-rates-and-data-ranges.md`
- Session-revoke flush fix (prerequisite phase): `.ai-factory/notes/04-session-revoke-flush-fix.md`
- Engine implementation spec: `.ai-factory/notes/05-biometric-stream-engine.md`
- Controller implementation spec: `.ai-factory/notes/06-biometric-stream-controller.md`
- Realtime docs edits (per-file specs): `.ai-factory/notes/07-realtime-docs-edits.md`
- Mirror file for engine: `src/realtime/services/stream-engine.service.ts`
- Mirror file for controller: `src/realtime/module-instruction-stream.grpc.controller.ts`
- Mirror file for registry: `src/realtime/services/active-stream-registry.service.ts`
- Forward reference in existing docs: `docs/realtime/instruction-model.md:71-83`
