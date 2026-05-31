# Plan Review: Serialize per-session flushes and clear only the persisted prefix

**Plan:** `32-serialize-per-session-flushes-chain-do-not-skip-and-clear-only-the-persisted-prefix.md`
**Risk Level:** 🟢 Low

## Verification Performed

- Read the plan, the source spec (`.ai-factory/notes/17-spec-stream-flush-correctness.md`), both target services, the existing `stream-engine.service.spec.ts`, both buffer interfaces, and ROADMAP Phase 24.
- Cross-checked every file path, method name, log line, and field name the plan references against the actual codebase.

### Findings

- **File paths correct.** `src/realtime/services/stream-engine.service.ts` and `biometric-stream-engine.service.ts` exist and contain the exact `flush` bodies the plan describes. `biometric-stream-engine.service.spec.ts` does **not** exist yet — Task 4 correctly labels it "new file".
- **Current code matches the plan's assumptions.** Both engines clear with `buffer.samples = []; buffer.byteSize = 0;` after `await save`, with the early-return, success log, and fire-and-forget `lastActivityAt` update exactly as the plan enumerates. The bio engine's `samples as unknown as Record<string, unknown>[]` cast and bio-specific log text (`Flushed ${samples.length} bio samples...`) are real and the plan preserves them.
- **The fix is correct and complete.** The chaining wrapper serializes overlapping periodic + terminal flushes (kills the duplicate insert), and `splice(0, count)` + `byteSize` recompute preserves samples pushed during `await save` (kills the tail loss). Placing the early-return inside `doFlush` (not the wrapper) is the right call — a terminal handler's `await flush()` must still wait for an in-flight flush before `buffers.delete()`, which a wrapper-level early-return would skip. The plan captures this reasoning faithfully.
- **byteSize recompute is consistent** with `push`/`pushBatch` accounting — both use `JSON.stringify(sample).length`, so `reduce((n, s) => n + JSON.stringify(s).length, 0)` reproduces the same running total. No drift.
- **Cumulative counters preserved.** Plan explicitly forbids touching `totalReceived` / `totalDropped` — matches the interface contracts (both documented as "not cleared on flush").
- **Test setup is accurate.** Task 3 builds on the real spec style (`makeRepo`/`makeModuleSessionRepo`/`makeConfig`, manual `new StreamEngine(...)`, `jest.useFakeTimers()`). Task 4's mirror correctly calls for `BIO_*` config keys, `pushBatch`, and the `BioSampleInternal` shape (`{ timestamp, sampleType, data }`).

### Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** PASS. Changes stay entirely within the `realtime` module; no cross-module imports or boundary violations introduced.
- **Rules (`.ai-factory/RULES.md`):** PASS. No non-null assertions added; no sensitive data logged (logs are IDs/counts only and preserved verbatim); "keep logs lean" honored (Settings: no new logs); the gRPC `@Payload()` rule is N/A to these engine methods.
- **Roadmap (`.ai-factory/ROADMAP.md`):** PASS. Maps directly to Phase 24, line 107 ("Serialize per-session flushes (chain, do NOT skip)...") — explicit milestone linkage present.

## Minor / Advisory (non-blocking)

- **Test teardown interaction.** The existing `afterEach` calls `engine.onApplicationShutdown()` (un-awaited) → `flushAll`. In the deferred-`save` scenarios, the test author must resolve any held `save` promise (or reset the mock) before/within teardown so a still-buffered session doesn't trigger an unexpected extra `save` against a deferred mock. This is an implementation detail for the test author, not a plan defect.
- **Fake timers + promises.** Modern `jest.useFakeTimers()` fakes timers only, not microtasks, so manually-resolved deferred promises and `void run.finally(...)` will settle normally. The deferred-promise approach in Tasks 3–4 is sound; just remember to `await` a microtask flush between resolving `save` and asserting.

## Positive Notes

- The plan reproduces the wrapper code verbatim from the spec, removing ambiguity for the implementer.
- It correctly identifies that the bio engine's log text and jsonb cast differ and must be preserved rather than blindly mirrored.
- Scope discipline is good: explicitly notes no migration, no proto, no API/ack change — consistent with a pure in-memory correctness fix.

PLAN_REVIEW_PASS
