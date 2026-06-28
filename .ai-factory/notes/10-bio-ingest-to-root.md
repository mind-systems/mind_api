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

### Inlined contracts (this note is self-contained — do not open other notes)
- **`activityEngine.ensureRoot(userId: string, clientTs?: number): Promise<ModuleSession | undefined>`** — a method on `ActivityEngine` (`src/realtime/services/activity-engine.service.ts`). Returns the user's existing root `ModuleSession` or lazily **creates** one and returns it. Async (DB write on creation). The result is `undefined` only in the unexpected case where creation yields nothing — that is the sole trigger for `NO_ROOT_SESSION`. (If `ensureRoot` is not yet present on `ActivityEngine` when this task runs, add it as part of root resolution: persist a `ModuleSession` row with `activityType = 'root'` for the user and return it.)
- **`ModuleSession` shape** (`src/realtime/entities/module-session.entity.ts`) — owner field is **`id: string`** (the uuid primary key, `@PrimaryGeneratedColumn('uuid')`). There is **no `sessionId` field** on this entity. Use `root.id` everywhere bio needs the owner id.
- **`WsErrorCode.NO_ROOT_SESSION`** (`src/realtime/constants/ws-error-codes.ts`) — a const object; `WsErrorCode.NO_ROOT_SESSION === 'NO_ROOT_SESSION'` and `WsErrorCode.SESSION_MISMATCH === 'SESSION_MISMATCH'` (literal string values).
- **Controller `handleBatch` step structure** (`module-biometric-stream.grpc.controller.ts:81-171`, private method): ordered guards — Step 1 empty batch → Step 2 missing sessionId (`samples[0].sessionId === ''`) → Step 3 inconsistent sessionId → Step 4 missing sampleType — each calls a local `emitError(code, message)` (`(code, message) => subscriber.next({ error: { code, message, timestamp } })`) then `return`. Steps 1–4 emit the literal `'INVALID_ARGUMENT'` and are **unchanged** by this task. Steps 5 (session resolution) and 6 (id comparison) are what this task rewrites; the happy path then maps samples and calls `this.streamEngine.pushBatch(ownerId, mapped)` and acks `sessionId: ownerId`.

### Change
- **Controller step 5** (`module-biometric-stream.grpc.controller.ts:116-121`): replace `getActiveSession` with root resolution via `ensureRoot` — the **only** path (the locked decision is that a bio-only connection *creates* a root):
  - `const root = await this.activityEngine.ensureRoot(userId, /* clientTs */);` — `handleBatch` becomes **async**. `ensureRoot` is (almost) never null; `NO_ROOT_SESSION` is reserved for the unexpected case where it yields nothing: `if (!root) { emitError(WsErrorCode.NO_ROOT_SESSION, 'No root session'); return; }`.
  - **Note 10 OWNS** the `WsErrorCode` wiring: the code `WsErrorCode.NO_ROOT_SESSION = 'NO_ROOT_SESSION'` already exists (`src/realtime/constants/ws-error-codes.ts:4`), but `WsErrorCode` is imported nowhere in this controller today. This task imports `WsErrorCode` and emits `WsErrorCode.NO_ROOT_SESSION` where step 5 emits the literal `'NO_SESSION'` today (`:119`). The committed test asserts the literal `'NO_ROOT_SESSION'` (spec `:396`) — value-equal, so emitting via `WsErrorCode.NO_ROOT_SESSION` stays GREEN.
- **Controller step 6** (`:123-130`): keep `SESSION_MISMATCH` but compare against **`root.id`, NOT `session.sessionId`**: `if (root.id !== batch.samples[0].sessionId) emitError(WsErrorCode.SESSION_MISMATCH, 'Session ID does not match root session'); return;`. `ensureRoot` returns a `ModuleSession` whose owner field is `.id`; the committed `makeRoot()` fixture has **no `sessionId` field** (`module-biometric-stream.grpc.controller.spec.ts:50-61`), so reading `session.sessionId` here yields `undefined` → SESSION_MISMATCH on every batch. Compare `root.id`.
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

## Test reconciliation (committed tests)

The committed bio tests stub **`ensureRoot`** (not `getRoot`) — matching the locked decision (§Decisions). Implementing this note's §Change (the `ensureRoot` path, `await` → `handleBatch` async) flips the four controller target cases RED→GREEN. There is no `getRoot` fork to implement — it has been dropped from §Change.

### GREEN list — `module-biometric-stream.grpc.controller.spec.ts`
`describe('streamData — bio bound to root')`:
- `[RED until spec 10] should resolve the user root and call pushBatch(root.id, …)` (`:342-362`) — asserts `frame.ack.sessionId === 'root-1'` and `pushBatch('root-1', any[])`.
- `[RED until spec 10] should reject a batch whose session_id is a child id with SESSION_MISMATCH` (`:364-380`) — `ensureRoot→root-1`, batch carries `child-9`, expects `frame.error.code === 'SESSION_MISMATCH'`, `pushBatch` NOT called.
- `[RED until spec 10] should emit NO_ROOT_SESSION when ensureRoot yields nothing` (`:382-397`) — `ensureRoot→undefined`, expects `frame.error.code === 'NO_ROOT_SESSION'`.
- `[RED until spec 10] should accept a batch for a paused root (pause does not block bio — P5 forward invariant)` (`:399-417`) — `ensureRoot→root(isPaused:true)`, expects `frame.ack` defined, `frame.error` undefined, `pushBatch` called.

### GREEN list — `biometric-stream-engine.service.spec.ts` (characterization — must STAY GREEN)
The engine is structurally unchanged (§Engine); these guard against breaking the id-agnostic flush — do NOT alter the `@OnEvent` handlers or the buffer key:
- `describe('root lifecycle flush (characterization — must stay GREEN)')`: `flushes and clears the per-root buffer on root ABANDONED` (`:267-280`); `… on REVOKED` (`:282-294`); `child COMPLETED is a harmless no-op when the child owns no buffer` (`:296-309`).
- `describe('root ABANDONED — flush coexistence')` → `should still flush the bio buffer on a root ABANDONED` (`:254-258`).
- `describe('overflow temporal density …')` → mid-batch oversized drop preserves neighbours (`:318-343`).

### Forward-couplings this note OWNS (pinned)
1. **Step 6 compares `root.id`, not `session.sessionId`** (§Change above). The committed `makeRoot()` fixture (`spec :50-61`) has no `sessionId` field; the current controller reads `session.sessionId` (`controller :124`) → `undefined` → SESSION_MISMATCH on every batch. **HIGH** (silent: blocks all 4 target GREEN cases).
2. **Retire the legacy pause pass-through chars.** `describe('streamData — pause pass-through')` (`spec :155-263`, four `it` at `:156, :180, :204, :228`) stub `activityEngine.getActiveSession` and send a child sessionId. Swapping step 5 to `ensureRoot` makes `getActiveSession` dead → those false-RED. The forward pause invariant is already re-expressed against a live root at `spec :399-417`, so **retire the legacy four** (delete them). **MEDIUM**.
3. **OWN the `WsErrorCode` import + `NO_ROOT_SESSION` emission** (§Change above). Code value exists at `ws-error-codes.ts:4`; `WsErrorCode` is imported nowhere in the controller and step 5 emits literal `'NO_SESSION'` (`:119`). **MEDIUM** (target case `:382-397` stays RED until done).

### handleBatch async
`ensureRoot` is awaited → `handleBatch` is `async`. The `request.subscribe` next-handler fire-and-forgets it (`controller :66-67`); `void`-ing the returned promise is fine. The test helper `firstNonReadyFrame` (`spec :70-87`) captures the first non-ready frame whenever it emits — no hang.

### ANTI-TARGETS
None to invert. The legacy pause pass-through four (`spec :155-263`) are **retired** (deleted), not inverted — superseded by the live-root paused case at `spec :399-417`.
