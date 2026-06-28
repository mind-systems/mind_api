# Bio ingest bound to the root timeline

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- Bio stops being a child of an activity and binds to the user's root session. The ingest controller validates the batch against the root (not the single active child), the engine buffers per-root, and the buffer flushes on **root** lifecycle, not activity completion.
- Pairs with the already-deployed tolerant read ([[09-analytics-tolerant-bio-read]]) so newly root-bound bio is immediately readable through the root branch — no dashboard gap.

## Details

### Current state — `src/realtime/module-biometric-stream.grpc.controller.ts`
- `handleBatch` step 5: `activityEngine.getActiveSession(userId)` → `NO_SESSION` if no active child. Step 6: `session.sessionId !== batch session_id` → `SESSION_MISMATCH`.
- `src/realtime/services/biometric-stream-engine.service.ts` buffers per `batchSessionId` (the child) and flushes on `@OnEvent` `COMPLETED` / `ABANDONED` / `INTERRUPTED` / `REVOKED` (keyed by `sessionId`).

### Change
- Controller: resolve the root via `activityEngine.getRoot(userId)` (call `ensureRoot` on first bio if none — see open question in [[04-lazy-root-creation]]). Replace step 5 with `NO_ROOT_SESSION` when no root. Replace step 6 with `batch.session_id !== root.id` → `SESSION_MISMATCH`. Push with `root.id`.
- Engine: no structural change — it is already keyed by an arbitrary `sessionId`; passing `root.id` makes the buffer per-root automatically. The flush `@OnEvent` handlers already fire on root lifecycle because the root emits `ABANDONED` (grace) / `REVOKED` (`closeAll`) with its own sessionId.
- Child completion (`activity:end/stop`) no longer carries bio — children never owned a bio buffer after this change, so their `COMPLETED`/`INTERRUPTED` events simply find no bio buffer (harmless no-op in the bio engine).

### Guards / gotchas
- Client contract change: the mobile app must now send `root.id` as `BioSample.session_id` (handled in [[13-mobile-proto-regen-behavior]]). Until mobile ships, bio batches carrying a child id will be rejected with `SESSION_MISMATCH` — acceptable because this feature is not yet released.
- Pause semantics unchanged: server still accepts any batch for a live root regardless of `isPaused`.
- Batch consistency rules (single session_id, non-empty sampleType) unchanged.
- Bio still persists to `bio_session_samples` with `moduleSessionId = root.id`.

### Verify
- Bio batch with the root id → accepted, rows have `moduleSessionId = root`.
- Bio batch with a child id → `SESSION_MISMATCH`.
- On root abandon/revoke → bio buffer flushed.
- Dashboard reads the new root bio for a child via the windowed root branch from [[09-analytics-tolerant-bio-read]].

## Open Questions
- Whether the bio stream alone (no state stream) should `ensureRoot`. Recommended yes, so a headset-only session is still captured.
