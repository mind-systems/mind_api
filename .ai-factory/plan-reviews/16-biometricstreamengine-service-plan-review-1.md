# Plan Review: BiometricStreamEngine service

**Plan reviewed:** `.ai-factory/plans/16-biometricstreamengine-service.md`
**Spec:** `.ai-factory/notes/05-biometric-stream-engine.md`
**Mirror reference:** `src/realtime/services/stream-engine.service.ts`

## Code Review Summary

**Files Reviewed:** 1 plan + 7 source files for codebase alignment
**Risk Level:** 🟢 Low

### Context Gates
- **Architecture (`ARCHITECTURE.md`):** PASS. Plan keeps the new engine inside `RealtimeModule`, owns its repositories via `@InjectRepository` within the same module, and adds no cross-module reach-in. Matches the modular-monolith rule.
- **Rules (`RULES.md`):** PASS. No non-null assertions introduced, no PII logged (only `sessionId`s), log shape stays lean (one info log per flush + one per event handler).
- **Roadmap:** Not applicable as a blocker — plan files are not required to link milestones.

### Codebase Alignment Verification
All references in the plan check out:
- `BioSampleInternal` and `BioSessionBuffer` exist with the exact fields the plan uses (`samples`, `byteSize`, `totalReceived`, `totalDropped`) — `src/realtime/interfaces/bio-session-buffer.interface.ts:2-21`.
- `BioSessionSample` entity exists with `moduleSessionId`, `samples: Record<string, unknown>[]`, `flushedAt` — `src/realtime/entities/bio-session-sample.entity.ts:11-26`. The plan's note about casting `BioSampleInternal[]` → `Record<string, unknown>[]` is correct: `data: unknown` is not assignable to an index signature, and the `as unknown as` double cast is the standard TS workaround.
- All four `RealtimeConfig` keys (`BIO_STREAM_MAX_BUFFER_BYTES`, `BIO_STREAM_MAX_SESSIONS`, `BIO_BACKPRESSURE_SAMPLES_PER_SEC`, `BIO_STREAM_FLUSH_INTERVAL_MS`) exist — `src/realtime/constants/realtime-config.ts:8-11`.
- All four `SessionEvents` (`COMPLETED`, `ABANDONED`, `INTERRUPTED`, `REVOKED`) are defined — `src/realtime/events/session.events.ts:1-7`. `REVOKED` is already handled in `StreamEngine` (lines 200-210), confirming the "Phase 18" prior-milestone claim.
- `RealtimeModule` already registers both `BioSessionSample` and `ModuleSession` in `TypeOrmModule.forFeature([...])` (`src/realtime/realtime.module.ts:23`), so Task 5 needs only to append the provider — matches what the plan describes.
- The `StreamEngine` mirror exists and uses the exact patterns the plan describes (setInterval handle on `flushTimer`, slice-then-save-then-clear order, fire-and-forget `moduleSessionRepo.update`).

### Critical Issues
None.

### Minor Observations (non-blocking)

1. **Operation ordering inside `flush` differs slightly from the mirror.** Plan task 3 lists steps as: save → clear → fire-and-forget update → info log. `StreamEngine.flush` does: save → clear → info log → fire-and-forget update (`stream-engine.service.ts:126-150`). Functionally equivalent — both are non-blocking and order does not affect correctness — but if the goal is "structurally mirror StreamEngine" exactly, swap steps 5 and 6 in the plan to match. Not blocking.

2. **"Logging: minimal" vs StreamEngine's double-log per event handler.** The mirror emits two log lines per event handler (`flushing sessionId=…` and `buffer cleared for sessionId=…`) — 8 lines total across 4 handlers. Plan task 4 only requires "a distinct log line per event for traceability," which leaves room for implementer to drop to one line per handler in keeping with the stated "minimal" logging setting. Worth clarifying during implementation: either match the mirror exactly (2 lines per handler) or trim to 1 — the plan currently allows either. Recommend trimming to one (`onSessionXxx: flushed & cleared sessionId=…`) since the project rule says "Keep logs lean."

3. **`maxSamplesPerSecond` getter has no current consumer.** The plan correctly explains the getter is for a Phase 19 controller. As long as Phase 19 lands in the same milestone batch, this is fine. If Phase 19 slips, the unused getter will trip dead-code lint warnings depending on ESLint config — not a problem with the plan itself, just a sequencing note.

4. **Module export decision is implicit.** Plan task 5 says "No new imports or exports needed — the engine is consumed only by the upcoming `ModuleBiometricStreamGrpcController` within the same module." That is correct given the architecture, but worth stating explicitly in the task body as "do NOT add `BiometricStreamEngine` to `exports`" so the implementer doesn't add it by mimicking other patterns.

### Positive Notes
- The "continue, do not break" requirement in `pushBatch` is well-justified in both spec and plan with the time-join analytics reasoning — this kind of explanatory comment in the plan helps prevent a well-meaning "early-exit optimization" during implementation.
- Cumulative-vs-per-call accounting on `totalReceived` / `totalDropped` is called out explicitly (do not reset on flush) — a common subtle bug avoided.
- The plan correctly handles the no-buffer/max-sessions edge case by returning the per-call dropped count as `totalDropped` since no buffer exists to carry cumulative state. Matches spec §`pushBatch` exactly.
- Lifecycle hooks match the mirror precisely (sync `onApplicationBootstrap` returning `void`, async `onApplicationShutdown`).
- Cast strategy for the `samples` jsonb column is explicit and uses the safe `as unknown as` form.

PLAN_REVIEW_PASS
