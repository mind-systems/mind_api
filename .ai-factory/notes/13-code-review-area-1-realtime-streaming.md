# Code Review — Area 1: Realtime streaming core (Phases 15, 17, 18, 19)

**Date:** 2026-05-31
**Source:** conversation context (full code read of all touched files)

## Scope

- **Phase 15** — `ModuleStateGrpcController.trackActivity` → `@GrpcCurrentUser()` injection
- **Phase 17** — `ModuleInstructionStreamGrpcController.streamData` → `@GrpcCurrentUser()` injection
- **Phase 18** — `SessionEvents.REVOKED` flush-on-revoke fix (controller emit + both engines)
- **Phase 19** — `ModuleBiometricStreamService` (proto, migration, entity, config, buffer interfaces, engine, controller, main.ts, docs)

## Key Findings

- **Phases 15 & 17 are clean.** Both controllers now read the user via `@GrpcCurrentUser()`, which pulls from the same metadata symbol key (`GRPC_USER_KEY`) the `GrpcAuthInterceptor` sets. No stale `(metadata as any)[GRPC_USER_KEY]` extraction left in any controller. Byte-for-byte behavior preservation confirmed. No issues.
- **Phase 18 is correct.** The emit-only-in-catch invariant holds: `ActivityEngine.stopActivity` can only throw at `findOne` or `repo.save` — both *before* the `INTERRUPTED` emit (line 236). So `INTERRUPTED` and `REVOKED` are mutually exclusive; the double-flush race note 04 warned about cannot occur via event emission. `REVOKED` handlers added to both `StreamEngine` and `BiometricStreamEngine` (verbatim copy of `onSessionInterrupted`). At most one terminal event per session.
- **Phase 19 implementation is faithful** to notes 03/05/06. Validation chain order is correct, ack carries all 5 fields, partial-accept byte accounting works, four `@OnEvent` flush handlers present.
- **MEDIUM (cross-cutting, pre-existing, inherited by new bio engine):** `flush()` is **not re-entrancy-safe** — see Details. A periodic `flushAll` overlapping a terminal-event flush of the same session can double-insert an identical sample batch.

## Details

### MEDIUM — non-reentrant `flush()` → possible duplicate sample batch
`StreamEngine.flush` / `BiometricStreamEngine.flush` (identical shape):
```
const samples = buffer.samples.slice();   // A
await this.sampleRepo.save(...)            // B (suspends event loop)
buffer.samples = [];                       // C (clear happens only after save)
```
Clearing *after* the await is a deliberate data-safety choice (preserve buffer on DB error). But it leaves a window: if the 5s periodic `flushAll` timer fires while a terminal-event handler (`COMPLETED`/`INTERRUPTED`/`REVOKED`) is suspended at B for the same session — or vice-versa — the second `flush()` re-reads the still-uncleared `buffer.samples` and issues a **second INSERT of the same batch**. There is no per-session in-flight guard and no insert idempotency. Result: duplicate rows in `session_stream_samples` / `bio_session_samples`, which surface as duplicate points in the web dashboard time-join.
- Phase 18 correctly avoided adding a *second event emit* (which would have made this trivially reproducible), but the **periodic timer is an independent flush trigger** that can still collide with a terminal flush.
- Low probability per-occurrence (requires overlap within DB save latency) but unbounded over time / fleet.
- Fix options: per-session in-flight lock (skip/await if a flush is running), or optimistic clear-before-await with rollback on save failure, or a unique constraint enabling ON CONFLICT dedup.

### LOW / observations (Phase 18)
- On `stopActivity` failure, in-memory `activitySessionStore` state is **not cleared** (delete is at line 228, after the throwing `save`). The lingering state can cause a stale RESUME on the user's next reconnect against a session still `ACTIVE` in DB. Pre-existing (the old catch only logged); Phase 18 didn't change it. Out of scope but worth tracking.
- `stats.worker.ts` listens on `COMPLETED`/`ABANDONED`/`INTERRUPTED` but **not** `REVOKED`. So a revoke-with-`stopActivity`-failure flushes buffers but never updates user stats for that session. Arguably consistent (the DB `save` also failed → session left non-terminal), so probably fine — but it means such sessions silently never reach stats.

### LOW / observations (Phase 19)
- `byteSize` is computed as `JSON.stringify(sample).length` — UTF-16 code-unit count, not UTF-8 byte count. Under-counts the real byte size for multibyte payloads, so `maxBufferBytes` is a soft over-estimate of capacity. Pre-existing pattern (matches `StreamEngine`); harmless.
- **Intentional divergence (documented):** bio ack `dropped_count` is **cumulative** (`result.totalDropped`), whereas instruction ack `dropped_count` is **per-message** (`result.droppedCount`, 0/1). Roadmap Phase 19 explicitly specifies "dropped_count semantically cumulative" for bio. Clients must know the two streams differ. Not a bug, but a contract footgun.
- `maxSamplesPerSecond` is reported in every ack but never enforced server-side — advisory backpressure, client self-throttles. Matches instruction stream by design.
- Bio buffer orphaning on `maxSessions` cap and on `stopActivity` early-return (no terminal event) — buffer can linger with empty samples in the Map; only deleted on terminal events. Pre-existing in `StreamEngine`; bounded by `maxSessions=1000`.

### Confirmed-correct details
- `module-state.grpc.controller.ts:182-198` — `handleSessionRevoked`: resolves `sessionId` before `stopActivity`, emits `REVOKED` only in catch, then `closeAll`. Correct.
- `active-stream-registry.service.ts` — multi-subscriber per user (`Map<userId, Set<Subscriber>>`); `closeAll` completes state + instruction + biometric streams for the user on revoke. Correct.
- `1779990145496-AddBioSessionSamplesTable.ts` — quoted camelCase columns, FK CASCADE to `module_sessions`, index on `moduleSessionId`. Mirrors `session_stream_samples`. Entity matches.
- All three new protos (`bci_devices`, `module_biometric_stream`, `nfb_calibration`) registered in `src/main.ts` protoPath — the `UNIMPLEMENTED` trap is avoided.

## Open Questions

- Should the `flush()` re-entrancy race be fixed now (cross-cutting, affects both engines) or tracked as a separate hardening task? It is the only finding above LOW in this area.
- Should `REVOKED` also notify `stats.worker` / sync, or is buffer-flush-only the intended scope?
