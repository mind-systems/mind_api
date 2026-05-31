# Spec — Phase 24: stream flush correctness

**Date:** 2026-05-31
**Source:** code review note 13 §MEDIUM + race analysis
**Targets:** `src/realtime/services/stream-engine.service.ts`, `src/realtime/services/biometric-stream-engine.service.ts`
**Scope:** no migration, no proto, no API/ack change.

## Problem

Both engines' `flush(sessionId)` do `const samples = buffer.samples.slice(); await sampleRepo.save(...); buffer.samples = []; buffer.byteSize = 0;`. The `await` yields the event loop, producing two **coupled** defects that must be fixed together:

1. **Duplicate insert.** The periodic `flushAll` timer (every `*_FLUSH_INTERVAL_MS`) is an independent trigger that can overlap a terminal-event flush (`COMPLETED`/`ABANDONED`/`INTERRUPTED`/`REVOKED`) for the same session. Because the buffer is cleared only after `await save`, the second concurrent flush re-reads the same uncleared array → duplicate rows in `session_stream_samples` / `bio_session_samples` (doubled points in the dashboard time-join).
2. **Tail/marker loss.** For an active session, `push` runs during the `await save` (the gRPC `next` handler appends sample N+1 while save of [0..N] is in flight). The unconditional `buffer.samples = []` then discards N+1 — silent data loss on every flush that overlaps an inbound sample.

A naive "if already flushing → return" guard fixes (1) but *worsens* (2): a terminal handler does `await flush(); buffers.delete()`; if its flush is skipped because the periodic flush holds the slot, the completion marker + tail are dropped by the subsequent `buffers.delete()`.

## Fix (apply identically to both engines)

Move the **entire current `flush` body verbatim** into a private `doFlush(sessionId)` — not just the snapshot→save→clear lines, but everything: the `if (!buffer || buffer.samples.length === 0) return` early-return, the success log line, and the fire-and-forget `moduleSessionRepo.update({ id: sessionId }, { lastActivityAt: now })` that currently runs after the buffer is cleared. Do not drop the `lastActivityAt` update or the logs. Then make `flush` a per-session **serialization point** (not a skip-guard):

**Early-return lives inside `doFlush`, not in the `flush` wrapper.** The wrapper below chains **unconditionally** (it always creates a chain entry and runs `doFlush`), so the empty/missing-buffer check must be the first thing inside `doFlush`. Two reasons: (a) a terminal handler's `await flush(sessionId)` must still wait for any in-flight flush of that session before its `buffers.delete()` runs, even when the buffer momentarily looks empty — putting the early-return in the wrapper would skip that wait; (b) each `flushAll` tick calls `flush` for every session, so an early-return in the wrapper that skipped chaining is unnecessary, while one inside `doFlush` makes the chained work a cheap no-op and the `finally` immediately drops the transient `flushChains` entry (no accumulation).

### (1) Serialize, do not skip
```ts
private readonly flushChains = new Map<string, Promise<void>>();

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
- Chaining makes a terminal `await flush(sessionId)` run its `doFlush` **after** any in-flight (periodic) flush completes → persists the remainder before `buffers.delete()`. No dup, no lost tail.
- `.catch(() => undefined)` on `prior` stops one failed flush from poisoning the chain.
- Keep terminal handlers' existing `await flush(); buffers.delete()` order — now safe.

### (2) Clear only the persisted prefix (inside `doFlush`)
`doFlush` keeps the current body's structure (early-return → snapshot → save → clear → log → `lastActivityAt` update); only the clear step changes:
```ts
async doFlush(sessionId: string): Promise<void> {
  const buffer = this.buffers.get(sessionId);
  if (!buffer || buffer.samples.length === 0) return;   // early-return stays HERE

  const count = buffer.samples.length;
  const samples = buffer.samples.slice(0, count);
  const now = new Date();
  await this.sampleRepo.save(this.sampleRepo.create({ moduleSessionId: sessionId, samples, flushedAt: now }));

  buffer.samples.splice(0, count);                       // remove only what was persisted (was: buffer.samples = [])
  buffer.byteSize = buffer.samples.reduce((n, s) => n + JSON.stringify(s).length, 0); // recompute (was: = 0)

  this.logger.log(`Flushed ${samples.length} samples for sessionId=${sessionId}`);   // keep existing log
  this.moduleSessionRepo.update({ id: sessionId }, { lastActivityAt: now })           // keep fire-and-forget update
    .catch((err) => this.logger.error(`Failed to update lastActivityAt for sessionId=${sessionId}`, err));
}
```
- Do **not** touch cumulative `totalReceived` / `totalDropped`.
- Preserve the "clear only after successful save" ordering (data-safety on DB error).
- The `lastActivityAt` fire-and-forget update and the log line move into `doFlush` unchanged — do not drop them.

## Test (regression)
A periodic flush held mid-`save` while a terminal flush of the same session fires must yield **exactly one row per distinct sample** AND the completion marker persisted (no duplicate, no loss). Cover both `StreamEngine` and `BiometricStreamEngine`.
