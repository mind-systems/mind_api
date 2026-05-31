# Plan: Serialize per-session flushes (chain, do NOT skip) and clear only the persisted prefix

## Context
Fix two coupled flush defects in both realtime stream engines — duplicate inserts from overlapping periodic + terminal flushes, and tail/marker loss from samples pushed during the `await save` — by serializing per-session flushes through a promise chain and clearing only the persisted prefix of the buffer.

## Settings
- Testing: yes (milestone explicitly requires a dup/loss regression test)
- Logging: minimal (preserve existing log lines verbatim — do not add new logs)
- Docs: no

## Tasks

### Phase 1: Stream engines

- [x] **Task 1: Serialize flushes + clear persisted prefix in `StreamEngine`**
  Files: `src/realtime/services/stream-engine.service.ts`
  Apply the fix from `.ai-factory/notes/17-spec-stream-flush-correctness.md`:
  - Add a private field `flushChains = new Map<string, Promise<void>>()`.
  - Rename the **entire current `flush(sessionId)` body verbatim** to a new private `async doFlush(sessionId: string): Promise<void>` — keep everything: the `if (!buffer || buffer.samples.length === 0)` early-return (including its `logger.debug` line), the snapshot, the `sampleRepo.save`, the clear, the success `logger.log`, and the fire-and-forget `moduleSessionRepo.update(..., { lastActivityAt: now })` with its `.catch`. Do not drop any log or the `lastActivityAt` update.
  - Inside `doFlush`, change only the clear step: capture `const count = buffer.samples.length;` before save, snapshot via `buffer.samples.slice(0, count)`, and replace `buffer.samples = []; buffer.byteSize = 0;` with `buffer.samples.splice(0, count);` followed by `buffer.byteSize = buffer.samples.reduce((n, s) => n + JSON.stringify(s).length, 0);`. Keep the "clear only after successful save" ordering. Do not touch `totalReceived`.
  - Make `flush(sessionId)` a thin per-session serialization wrapper that **chains unconditionally** (no skip-guard, no early-return in the wrapper):
    ```ts
    async flush(sessionId: string): Promise<void> {
      const prior = (this.flushChains.get(sessionId) ?? Promise.resolve()).catch(() => undefined);
      const run = prior.then(() => this.doFlush(sessionId));
      this.flushChains.set(sessionId, run);
      void run.finally(() => {
        if (this.flushChains.get(sessionId) === run) this.flushChains.delete(sessionId);
      });
      return run;
    }
    ```
  - Leave `flushAll`, `push`, and all terminal `@OnEvent` handlers (`await flush(); buffers.delete()` order) unchanged — they are now safe.

- [x] **Task 2: Apply the identical fix to `BiometricStreamEngine`** (depends on Task 1)
  Files: `src/realtime/services/biometric-stream-engine.service.ts`
  Mirror Task 1 exactly: add `flushChains` map, extract current `flush` body into private `doFlush` (preserving the `samples as unknown as Record<string, unknown>[]` cast, the bio-specific log text `Flushed ${samples.length} bio samples for sessionId=...`, the early-return debug log, and the `lastActivityAt` fire-and-forget update), replace `buffer.samples = []; buffer.byteSize = 0;` with `splice(0, count)` + `byteSize` recompute via `reduce`, and add the same chaining `flush` wrapper. Do not reset cumulative `totalReceived` / `totalDropped`.

### Phase 2: Regression tests

- [x] **Task 3: Dup/loss regression test for `StreamEngine`** (depends on Task 1)
  Files: `src/realtime/services/stream-engine.service.spec.ts`
  Add a `describe('flush concurrency / correctness')` block following the existing test style (manual `new StreamEngine(repo, moduleSessionRepo, config)`, jest mocks). Cover, for the instruction engine:
  - **No duplicate on overlapping flush:** make `repo.save` return a deferred promise (resolve manually) to hold a flush mid-`save`; while it is in flight, fire a second `flush('s1')` (simulating the periodic + terminal overlap); resolve the first save. Assert each distinct sample is persisted in exactly one saved batch (no sample appears twice across all `repo.save` calls).
  - **No tail loss:** while a flush is held mid-`save`, `push` a new sample N+1 to the same session, then resolve the save and run/await the chained flush. Assert N+1 is persisted (appears in a later saved batch) and `byteSize` reflects the remaining buffer correctly (recomputed, not zeroed away).
  - **Terminal flush after periodic persists remainder:** hold a periodic `flush`, then call `onSessionCompleted({ sessionId })`; assert its `doFlush` runs after the in-flight flush completes and the buffer is deleted only after the remainder is saved (no lost completion tail).

- [x] **Task 4: Dup/loss regression test for `BiometricStreamEngine`** (depends on Task 2)
  Files: `src/realtime/services/biometric-stream-engine.service.spec.ts` (new file)
  Create the spec mirroring the StreamEngine spec's setup (factory helpers for `sampleRepo`, `moduleSessionRepo`, `config` using `RealtimeConfig.BIO_*` keys; `pushBatch` instead of `push`; bio sample shape from `src/realtime/interfaces/bio-session-buffer.interface.ts`). Cover the same three scenarios as Task 3 (no duplicate on overlapping flush, no tail loss for samples pushed during `await save`, terminal flush after periodic persists remainder) against `BiometricStreamEngine`.

## Notes
- No migration, no proto, no API/ack changes — pure in-memory correctness fix (per spec scope).
- Run `npm run lint` and `npx jest src/realtime/services/stream-engine.service.spec.ts src/realtime/services/biometric-stream-engine.service.spec.ts` after implementation.
- Single commit at the end (4 tasks): "Serialize per-session stream flushes and clear only the persisted prefix".
