# Plan: BiometricStreamEngine service

## Context
Implement `BiometricStreamEngine` — the in-memory buffer + periodic flush service for biometric samples — mirroring `StreamEngine` structurally, persisting batches to `bio_session_samples` and flushing on the four `SessionEvents` (`COMPLETED`, `ABANDONED`, `INTERRUPTED`, `REVOKED`). Spec: `.ai-factory/notes/05-biometric-stream-engine.md`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Service implementation

- [x] **Task 1: Create `BiometricStreamEngine` service file with DI and lifecycle hooks**
  Files: `src/realtime/services/biometric-stream-engine.service.ts`
  Create a new `@Injectable()` class `BiometricStreamEngine` implementing `OnApplicationBootstrap` and `OnApplicationShutdown`. Structurally mirror `src/realtime/services/stream-engine.service.ts`. Constructor injects:
  - `@InjectRepository(BioSessionSample) private readonly sampleRepo: Repository<BioSessionSample>` (entity from `../entities/bio-session-sample.entity`)
  - `@InjectRepository(ModuleSession) private readonly moduleSessionRepo: Repository<ModuleSession>` (entity from `../entities/module-session.entity`)
  - `private readonly configService: ConfigService`

  Read four cached numeric config values via `configService.get<number>(KEY, DEFAULT)` using `RealtimeConfig` keys (from `../constants/realtime-config`):
  - `BIO_STREAM_MAX_BUFFER_BYTES` → default `1048576`, stored on `private readonly maxBufferBytes`
  - `BIO_STREAM_MAX_SESSIONS` → default `1000`, stored on `private readonly maxSessions`
  - `BIO_BACKPRESSURE_SAMPLES_PER_SEC` → default `50`, stored on `private readonly _maxSamplesPerSecond`
  - `BIO_STREAM_FLUSH_INTERVAL_MS` → default `5000`, stored on `private readonly flushIntervalMs`

  Add public getter `get maxSamplesPerSecond(): number { return this._maxSamplesPerSecond; }` (controller in Phase 19 reads it for the ack).

  Internal state: `private readonly logger = new Logger(BiometricStreamEngine.name)` and `private readonly buffers = new Map<string, BioSessionBuffer>()` (type from `../interfaces/bio-session-buffer.interface`). `private flushTimer: ReturnType<typeof setInterval> | undefined`.

  Lifecycle (identical to `StreamEngine`):
  - `onApplicationBootstrap(): void` — `this.flushTimer = setInterval(() => { this.flushAll().catch((err: unknown) => this.logger.error('Periodic flush failed', err)); }, this.flushIntervalMs);`
  - `async onApplicationShutdown(): Promise<void>` — if `flushTimer` defined, `clearInterval(this.flushTimer)`; then `await this.flushAll()`.

- [x] **Task 2: Implement `pushBatch(sessionId, samples)` with per-sample partial-accept accounting** (depends on Task 1)
  Files: `src/realtime/services/biometric-stream-engine.service.ts`
  Add method:
  ```
  pushBatch(sessionId: string, samples: BioSampleInternal[]):
    { acceptedCount: number; droppedCount: number; totalReceived: number; totalDropped: number; }
  ```
  Logic per spec §`pushBatch`:
  1. `let buffer = this.buffers.get(sessionId);`
  2. If `!buffer`:
     - If `this.buffers.size >= this.maxSessions` — reject whole batch and return `{ acceptedCount: 0, droppedCount: samples.length, totalReceived: 0, totalDropped: samples.length }`. Do **not** create a buffer; cumulative counters cannot persist, so return the per-call dropped count as `totalDropped` for this single response.
     - Else create `{ sessionId, samples: [], byteSize: 0, totalReceived: 0, totalDropped: 0 }` and `this.buffers.set(sessionId, buffer)`.
  3. Initialize `let acceptedCount = 0; let droppedCount = 0;` then iterate `for (const sample of samples)`:
     - `const sampleBytes = JSON.stringify(sample).length;`
     - If `buffer.byteSize + sampleBytes > this.maxBufferBytes` — drop: `buffer.totalDropped += 1; droppedCount += 1;` and **`continue` (do not `break`)** — preserves temporal density of accepted samples around a drop, which the time-join analytics depends on.
     - Else `buffer.samples.push(sample); buffer.byteSize += sampleBytes; buffer.totalReceived += 1; acceptedCount += 1;`.
  4. Return `{ acceptedCount, droppedCount, totalReceived: buffer.totalReceived, totalDropped: buffer.totalDropped }`.

- [x] **Task 3: Implement `flush(sessionId)` and `flushAll()`** (depends on Task 1)
  Files: `src/realtime/services/biometric-stream-engine.service.ts`
  Mirror `StreamEngine.flush`:
  1. `const buffer = this.buffers.get(sessionId);` If missing or `buffer.samples.length === 0` — `this.logger.debug(...)` and return.
  2. `const samples = buffer.samples.slice(); const now = new Date();`
  3. `await this.sampleRepo.save(this.sampleRepo.create({ moduleSessionId: sessionId, samples, flushedAt: now }));`
  4. Clear `buffer.samples = []; buffer.byteSize = 0;` (do **not** reset `totalReceived` or `totalDropped` — those are cumulative).
  5. Fire-and-forget `this.moduleSessionRepo.update({ id: sessionId }, { lastActivityAt: now }).catch((err: unknown) => this.logger.error(..., err));`.
  6. Add an info log message naming the engine for traceability (e.g. `Flushed ${samples.length} bio samples for sessionId=${sessionId}`).

  Note: `BioSessionSample.samples` is typed `Record<string, unknown>[]` while `BioSampleInternal[]` is the input array. Cast at the `.create({...})` call site (e.g. `samples: samples as unknown as Record<string, unknown>[]`) — runtime shape is JSON-safe, the cast is only to satisfy the typed entity.

  Implement `async flushAll(): Promise<void>` — iterate `Array.from(this.buffers.keys())`, `await this.flush(id)` inside `try/catch` and `this.logger.error(...)` on individual failure.

- [x] **Task 4: Add four `@OnEvent` flush-and-delete handlers** (depends on Task 3)
  Files: `src/realtime/services/biometric-stream-engine.service.ts`
  Import `OnEvent` from `@nestjs/event-emitter` and `SessionEvents` from `../events/session.events`. Add four handlers with identical bodies — `await this.flush(payload.sessionId); this.buffers.delete(payload.sessionId);` — and a distinct log line per event for traceability:
  - `@OnEvent(SessionEvents.COMPLETED) async onSessionCompleted(payload: { sessionId: string }): Promise<void>`
  - `@OnEvent(SessionEvents.ABANDONED) async onSessionAbandoned(payload: { sessionId: string }): Promise<void>`
  - `@OnEvent(SessionEvents.INTERRUPTED) async onSessionInterrupted(payload: { sessionId: string }): Promise<void>`
  - `@OnEvent(SessionEvents.REVOKED) async onSessionRevoked(payload: { sessionId: string }): Promise<void>` — the Phase 18 event added to `StreamEngine` in the previous milestone.

### Phase 2: Module wiring

- [x] **Task 5: Register `BiometricStreamEngine` as a provider in `RealtimeModule`** (depends on Task 4)
  Files: `src/realtime/realtime.module.ts`
  Import `BiometricStreamEngine` from `./services/biometric-stream-engine.service`. Append it to the `providers` array (next to `StreamEngine`). `BioSessionSample` and `ModuleSession` entities are already registered in `TypeOrmModule.forFeature([...])` (Phase 19, prior task). No new imports or exports needed — the engine is consumed only by the upcoming `ModuleBiometricStreamGrpcController` within the same module.

<!-- orchestrator-sessions
planner: 631cc52c-475c-4696-ba11-9eff15adb786
elapsed: 417
implementer: 3555acaf-b417-484a-9d82-5211405c5c89
-->
