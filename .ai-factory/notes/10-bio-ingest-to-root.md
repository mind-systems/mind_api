# Bio ingest bound to the root timeline

**Date:** 2026-06-28
**Source:** conversation context

## Decisions (locked)
- A bio-only connection (bio stream with no state stream / no practice) **does** call `ensureRoot` — a headset-only session is captured, and the empty-root janitor ([[08-janitor-empty-roots]]) reaps it if no practice ever starts. So step 5 below *creates* a root rather than erroring; `NO_ROOT_SESSION` is reserved for the (unexpected) case where `ensureRoot` itself yields nothing.

## Key Findings

- Bio stops being a child of an activity and binds to the user's root session. The ingest controller validates the batch against the root (not the single active child), the engine buffers per-root, and the buffer flushes on **root** lifecycle, not activity completion.
- Pairs with the already-deployed tolerant read ([[09-analytics-tolerant-bio-read]]) so newly root-bound bio is immediately readable through the root branch — no dashboard gap.

## Details

### Current state — `src/realtime/module-biometric-stream.grpc.controller.ts`
- `handleBatch` (`:81-171`) validates in ordered steps:
  - Step 1 empty batch (`:90-94`), Step 2 missing sessionId (`:96-100`), Step 3 inconsistent sessionId (`:102-108`), Step 4 missing sampleType (`:110-114`) — all unchanged.
  - **Step 5** (`:116-121`): `const session = this.activityEngine.getActiveSession(userId); if (!session) emitError('NO_SESSION', 'No active session found')`.
  - **Step 6** (`:123-130`): `if (session.sessionId !== batch.samples[0].sessionId) emitError('SESSION_MISMATCH', 'Session ID does not match active session')`.
  - Happy path (`:132-157`): `batchSessionId = batch.samples[0].sessionId` (`:133`); `this.streamEngine.pushBatch(batchSessionId, mapped)` (`:141`); ack carries `sessionId: batchSessionId` (`:145`).
  - Note: error codes are emitted as **string literals** today (`'NO_SESSION'`, `'SESSION_MISMATCH'` at `:119,:126`), not `WsErrorCode.*`. `WsErrorCode` is imported nowhere in this controller yet.
- `getRoot` does **not** exist on `ActivityEngine` today — only `getActiveSession(userId)` (`activity-engine.service.ts:401-403`). `getRoot(userId)` is the store accessor introduced by [[03-multi-session-store-engine]]; expose/forward it from `ActivityEngine` (or call `activitySessionStore.getRoot(userId)`) as part of [[04-lazy-root-creation]] before this task.
- `ActivityEngine.ensureRoot(userId, clientTs?)` is added by [[04-lazy-root-creation]]; it returns the existing root or lazily creates one.
- `src/realtime/services/biometric-stream-engine.service.ts` buffers per the `sessionId` argument of `pushBatch` (`:77-133`, `this.buffers` keyed by `sessionId` at `:86,:104`) and flushes on `@OnEvent` `COMPLETED` (`:204`), `ABANDONED` (`:216`), `INTERRUPTED` (`:228`), `REVOKED` (`:240`) — each keyed by `payload.sessionId`.

### Change
- **Controller step 5** (`module-biometric-stream.grpc.controller.ts:116-121`): replace `getActiveSession` with root resolution.
  - If the bio-only-ensureRoot fork (see Blocking decisions) is **yes**: `const root = await this.activityEngine.ensureRoot(userId, /* clientTs */);` (handleBatch becomes async / returns the promise) — never null.
  - If **no**: `const root = this.activityEngine.getRoot(userId); if (!root) { emitError(WsErrorCode.NO_ROOT_SESSION, 'No root session'); return; }`.
  - The new error code `NO_ROOT_SESSION` is already added: `WsErrorCode.NO_ROOT_SESSION = 'NO_ROOT_SESSION'` (`src/realtime/constants/ws-error-codes.ts:4`). Import `WsErrorCode` into this controller and emit `WsErrorCode.NO_ROOT_SESSION` (replacing the old literal `'NO_SESSION'`).
- **Controller step 6** (`:123-130`): keep `SESSION_MISMATCH` but compare against the root id: `if (root.id !== batch.samples[0].sessionId) emitError(WsErrorCode.SESSION_MISMATCH, 'Session ID does not match root session'); return;`. (`root.id` for an `ensureRoot` `ModuleSession`, or `root.sessionId` if `getRoot` returns the store `ActivityState` — match whichever shape [[03-multi-session-store-engine]] exposes.)
- **Happy path** (`:132-141`): push with the root id — `this.streamEngine.pushBatch(root.id, mapped)` (replacing `batchSessionId` at `:141`). The ack `sessionId` (`:145`) should also be the root id.
- **Engine**: no structural change — `pushBatch` (`biometric-stream-engine.service.ts:77`) is keyed by an arbitrary `sessionId`, so passing `root.id` makes the buffer per-root automatically.

### Which flush handlers fire on root lifecycle
- The four flush handlers (`biometric-stream-engine.service.ts:204/216/228/240`) flush by `payload.sessionId`. They flush the root's bio **only if** the root itself emits one of those events with **its own** sessionId:
  - **ABANDONED** — emitted by `abandonActivity` (`activity-engine.service.ts:219`) and `abandonStale` (`:273`) per session. Per [[04-lazy-root-creation]] the root is disconnected + grace-abandoned generically by the per-session loop ([[03-multi-session-store-engine]]), so it emits `ABANDONED` with `sessionId = root.id` → root bio flushed.
  - **REVOKED** — `handleSessionRevoked` (`module-state.grpc.controller.ts:198-213`) currently emits `SessionEvents.REVOKED` per child id (`:210`) and only in the `catch` branch, then `closeAll` (`:213`). It does **not** today emit REVOKED for the root. Confirm [[03-multi-session-store-engine]] makes revoke loop over **every** child + the root (its Guards say "stop every child + the root, then closeAll") and emit REVOKED with `root.id`, otherwise root bio is not flushed on revoke (the empty-root janitor delete would still cascade it away, but unflushed buffered samples are lost).
  - **COMPLETED** / **INTERRUPTED** — fire on `activity:end` / `activity:stop` of a **child**, with the child's id. After this change children own no bio buffer, so these handlers find no buffer for the child id → harmless no-op (`doFlush` returns early when `buffer` is missing, `biometric-stream-engine.service.ts:150-157`).

### Guards / gotchas
- Client contract change: the mobile app must now send `root.id` as `BioSample.session_id` (handled in [[13-mobile-proto-regen-behavior]]). Until mobile ships, bio batches carrying a child id are rejected with `SESSION_MISMATCH` — acceptable because this feature is not yet released.
- Pause semantics unchanged: server still accepts any batch for a live root regardless of `isPaused`.
- Batch consistency rules (single session_id — step 3 `:102-108`; non-empty sampleType — step 4 `:110-114`) unchanged.
- Bio still persists to `bio_session_samples` with `moduleSessionId = root.id` (`doFlush` save at `biometric-stream-engine.service.ts:163-169`).

### Verify
- Bio batch with the root id → accepted, rows have `moduleSessionId = root`.
- Bio batch with a child id → `SESSION_MISMATCH`.
- On root abandon/revoke → bio buffer flushed (confirm root REVOKED is emitted, see above).
- Dashboard reads the new root bio for a child via the windowed root branch from [[09-analytics-tolerant-bio-read]].

## Open Questions
- None remaining (the bio-only `ensureRoot` fork is promoted to Blocking decisions above).
