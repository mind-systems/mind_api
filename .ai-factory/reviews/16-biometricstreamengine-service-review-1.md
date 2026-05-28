# Code Review: BiometricStreamEngine service

**Plan:** `.ai-factory/plans/16-biometricstreamengine-service.md`
**Spec:** `.ai-factory/notes/05-biometric-stream-engine.md`
**Mirror reference:** `src/realtime/services/stream-engine.service.ts`

## Files reviewed

- `src/realtime/services/biometric-stream-engine.service.ts` (new, 231 lines)
- `src/realtime/realtime.module.ts` (1 import + 1 provider added)
- `src/realtime/entities/bio-session-sample.entity.ts` (unchanged, verified shape)
- `src/realtime/entities/module-session.entity.ts` (unchanged, verified `lastActivityAt`)
- `src/realtime/interfaces/bio-session-buffer.interface.ts` (unchanged, verified `BioSampleInternal` / `BioSessionBuffer` shapes)
- `src/realtime/constants/realtime-config.ts` (unchanged, verified four `BIO_*` keys exist)
- `src/realtime/events/session.events.ts` (unchanged, verified four event constants)

## Correctness check vs. spec

Walked every spec section against the implementation:

- **DI:** constructor injects `BioSessionSample` repo, `ModuleSession` repo, `ConfigService`. ✅
- **Config reads:** four `BIO_*` keys with the spec'd defaults `1048576 / 1000 / 50 / 5000`. ✅
- **`maxSamplesPerSecond` getter** present, returns cached value. ✅
- **Lifecycle hooks:** `onApplicationBootstrap` starts `setInterval(flushAll, flushIntervalMs)` storing the handle on `flushTimer`; `onApplicationShutdown` clears it and awaits a final `flushAll`. Matches `StreamEngine` exactly. ✅
- **`pushBatch`:** max-sessions guard returns `{accepted:0, dropped:N, totalReceived:0, totalDropped:N}` without creating a buffer (matches spec §`pushBatch` step 2 verbatim). Per-sample loop uses `continue`, not `break`, on per-sample overflow — preserving time-join density as the spec mandates. Counters update both per-call and cumulative correctly. ✅
- **`flush`:** order is missing-buffer guard → slice → save → clear → log → fire-and-forget `lastActivityAt` update. Cumulative counters `totalReceived` / `totalDropped` are **not** reset on clear. ✅
- **`flushAll`:** iterates a snapshot of keys, awaits each `flush` inside try/catch with error log. ✅
- **Event handlers:** all four `@OnEvent` subscribers (`COMPLETED`, `ABANDONED`, `INTERRUPTED`, `REVOKED`) registered with `flush + buffers.delete` bodies and distinct log lines. ✅
- **Module registration:** `BiometricStreamEngine` added to `RealtimeModule.providers` alongside `StreamEngine`. No `exports` entry (correct — consumed only by Phase 19's controller within the same module). ✅
- **Repository feature registration:** `BioSessionSample` and `ModuleSession` are both present in `TypeOrmModule.forFeature([...])` from prior phases — `@InjectRepository` resolves. ✅

## Runtime safety check

- **Migration:** `bio_session_samples` table was added in the Phase 19 migration (already merged in `[x] Migration AddBioSessionSamplesTable`). `BioSessionSample.flushedAt` is `@Column()` with no type — Postgres will receive a `Date`, TypeORM will pick `timestamp without time zone` (matches the pattern of `SessionStreamSample.flushedAt`, which works in production). No drift between entity and table.
- **`samples` jsonb cast:** `samples as unknown as Record<string, unknown>[]` is the correct workaround for the `BioSampleInternal.data: unknown` → index-signature mismatch. Runtime payload is JSON-safe (`JSON.stringify` is even used upstream for byte accounting). No data loss.
- **`moduleSessionRepo.update` fire-and-forget:** identical pattern to `StreamEngine`. On flush, both engines may issue near-simultaneous updates to the same `module_sessions` row — they each write `lastActivityAt = new Date()` of approximately the same value, so the last-writer-wins outcome is benign.
- **Periodic flush vs. event-handler flush race:** if `setInterval` fires `flushAll` at the same instant a `SessionEvents.X` handler fires, both can `samples.slice()` from the same non-cleared array and insert the same batch twice (then both clear). This is the **same pre-existing race that already lives in `StreamEngine`** (`src/realtime/services/stream-engine.service.ts:114-151`) — not introduced here, not in scope for this milestone. The Phase 18 `REVOKED` fix already addressed the most severe variant (double-emit on revoke); the periodic-vs-event window remains for both engines. Flag for future hardening, not a blocker for this PR.
- **No-buffer max-sessions return value:** when capacity is full, `totalReceived: 0` is returned even if the controller previously had cumulative state from another (now-evicted) session — but per spec this is intentional (no buffer ⇒ no state to carry), so the controller must treat `totalReceived` as authoritative only when a buffer exists. The spec calls this out explicitly; not a bug.
- **Empty-batch call:** `pushBatch(sessionId, [])` with no existing buffer and capacity available will create an empty buffer and return `{accepted:0, dropped:0, totalReceived:0, totalDropped:0}`. Harmless — the buffer is reusable on the next non-empty call. Matches `StreamEngine` behavior shape.

## Type/lint check

- `BioSessionBuffer` import is correct path (`../interfaces/bio-session-buffer.interface`).
- `SessionEvents`, `RealtimeConfig` imports resolve.
- No non-null assertions, no `any` introduced (only the explicit `as unknown as Record<…>` cast, justified by the spec). Matches project rules.
- Logger error second-arg pattern (`(message, err: unknown)`) is identical to `StreamEngine` — NestJS Logger accepts it.

## Findings

None critical. The implementation is a clean structural mirror of `StreamEngine`, with the four per-spec deviations (4 config keys instead of 4 different ones, `pushBatch` instead of `push`, `BioSessionBuffer` with `totalDropped`, four event handlers including `REVOKED`) implemented exactly as the spec dictates. Wiring in `RealtimeModule` is minimal and correct.

REVIEW_PASS
