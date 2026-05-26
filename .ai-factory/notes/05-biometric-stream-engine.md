# BiometricStreamEngine — Implementation Spec

**Date:** 2026-05-23
**Status:** decisions locked
**Parent doc:** `.ai-factory/notes/03-biometric-stream-service.md` (architectural decisions §5)
**Mirror file:** `src/realtime/services/stream-engine.service.ts`
**New file:** `src/realtime/services/biometric-stream-engine.service.ts`

## Shape

`@Injectable()` class implementing `OnApplicationBootstrap`, `OnApplicationShutdown`. Mirrors `StreamEngine` structurally; differs only at the points called out below.

## DI

Constructor injects:
- `@InjectRepository(BioSessionSample) private readonly sampleRepo: Repository<BioSessionSample>`
- `@InjectRepository(ModuleSession) private readonly moduleSessionRepo: Repository<ModuleSession>` — for `lastActivityAt` updates, identical pattern to `StreamEngine`
- `private readonly configService: ConfigService`

Reads four config values via `configService.get<number>(KEY, DEFAULT)`:

| Constant from `RealtimeConfig` | Default |
|---|---|
| `BIO_STREAM_MAX_BUFFER_BYTES` | `1048576` (1 MB) |
| `BIO_STREAM_MAX_SESSIONS` | `1000` |
| `BIO_BACKPRESSURE_SAMPLES_PER_SEC` | `50` |
| `BIO_STREAM_FLUSH_INTERVAL_MS` | `5000` |

Exposed getter `maxSamplesPerSecond: number` returns the cached backpressure value (controller reads it for the ack).

## Internal state

`private readonly buffers = new Map<string, BioSessionBuffer>()` — one buffer per `moduleSessionId`. `BioSessionBuffer` type from `src/realtime/interfaces/bio-session-buffer.interface.ts` (Phase 19 interface task).

## Lifecycle hooks

- `onApplicationBootstrap()` — start `setInterval(() => this.flushAll().catch(log), this.flushIntervalMs)`. Store handle in `private flushTimer`.
- `onApplicationShutdown()` — `clearInterval(this.flushTimer)`, then `await this.flushAll()`.

Both identical to `StreamEngine`.

## `pushBatch(sessionId, samples)`

Signature:

```
pushBatch(sessionId: string, samples: BioSampleInternal[]):
  { acceptedCount: number; droppedCount: number; totalReceived: number; totalDropped: number; }
```

Logic:

1. Look up `buffer = this.buffers.get(sessionId)`.
2. If `!buffer`:
   - If `this.buffers.size >= this.maxSessions` — reject the whole batch: `acceptedCount=0`, `droppedCount=samples.length`, `totalReceived=0`, `totalDropped=samples.length`. No buffer is created; cumulative counters cannot persist, so we return the per-call dropped count as `totalDropped` for that single response.
   - Else create `{ sessionId, samples: [], byteSize: 0, totalReceived: 0, totalDropped: 0 }`, store it.
3. Iterate `samples`, for each:
   - `const sampleBytes = JSON.stringify(sample).length;`
   - If `buffer.byteSize + sampleBytes > maxBufferBytes` — drop: `buffer.totalDropped += 1`, per-call `droppedCount += 1`. **Continue, do not break** — this is a correctness requirement, not a micro-optimization. Time-join analytics depends on preserving the temporal density of accepted samples around a drop: dropping the 5th of a 100-sample batch and continuing leaves a one-sample gap with neighbours intact; dropping everything after the 5th would create a 95-sample cliff that wrongly looks like signal loss. Optionally include dropped sample timestamps in the controller warn-log for production debugging — not blocking.
   - Else append: `buffer.samples.push(sample)`, `buffer.byteSize += sampleBytes`, `buffer.totalReceived += 1`, per-call `acceptedCount += 1`.
4. Return `{ acceptedCount, droppedCount, totalReceived: buffer.totalReceived, totalDropped: buffer.totalDropped }`.

## `flush(sessionId)`

Mirror of `StreamEngine.flush`:

1. Look up buffer; if missing or `samples.length === 0` — debug log + return.
2. `const samples = buffer.samples.slice(); const now = new Date();`
3. `await this.sampleRepo.save(this.sampleRepo.create({ moduleSessionId: sessionId, samples, flushedAt: now }))`.
4. Clear `buffer.samples = []`, `buffer.byteSize = 0` — **do not reset** `totalReceived` or `totalDropped` (cumulative since buffer creation).
5. Fire-and-forget `moduleSessionRepo.update({ id: sessionId }, { lastActivityAt: now }).catch(log)`.

## `flushAll()`

Iterate `Array.from(this.buffers.keys())`, await each `this.flush(id)` inside try/catch, log on individual failure. Identical to `StreamEngine.flushAll`.

## Event handlers

Four `@OnEvent` handlers — `COMPLETED`, `ABANDONED`, `INTERRUPTED`, `REVOKED` (the last one is added in Phase 18 to the existing `StreamEngine` too — see note 04). Each one:

```
async on<Event>(payload: { sessionId: string }): Promise<void> {
  await this.flush(payload.sessionId);
  this.buffers.delete(payload.sessionId);
}
```

Identical bodies, only the log message differs per event for traceability.

## Register

Add as a provider in `RealtimeModule.providers`.

## Persisted shape

Each row in `bio_session_samples`:
- `moduleSessionId` ← `sessionId` arg
- `samples` ← jsonb array; each element `{ timestamp, sampleType, data }` (no `sessionId` field inside — redundant with the row's `moduleSessionId`)
- `flushedAt` ← `now()`
- `createdAt` ← default
