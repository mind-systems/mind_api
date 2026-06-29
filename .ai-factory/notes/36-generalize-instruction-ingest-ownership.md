# Generalize instruction ingest from single-child to any owned live session (F3)

**Date:** 2026-06-29
**Source:** conversation context (handoff 06-generic-session-data-flow §F3)

Feature task — the meaty one. Tested by [[33-test-instruction-ownership]]; its pause-suite wiring is corrected by [[38-test-instruction-pause-dual-mock]]. Enables **N concurrent activities' phase streams** (the core vision) and **root-level client marks**. Depends on [[34-deliver-root-id-on-connect]] (the client learns `root.id` from its `activity:start { activity_type: ROOT }` response — itself a valid owned session to tag a mark with).

## Problem today — `src/realtime/module-instruction-stream.grpc.controller.ts`
The per-sample handler in `streamData` (`:64-140`) accepts **only the single active child**:

```ts
// :67-76  hygiene — keep
if (!msg.sessionId) { emitError('INVALID_ARGUMENT', 'Missing sessionId'); return; }

// :78-89  single-session resolution — REPLACE
const session = this.activityEngine.getActiveSession(userId);
if (!session) { emitError('NO_SESSION', 'No active session found'); return; }

// :91-100 echo-match — DELETE
if (session.sessionId !== msg.sessionId) {
  emitError('SESSION_MISMATCH', 'Session ID does not match active session'); return;
}

// :102-117 push + ack — keep
const result = this.streamEngine.push(msg.sessionId, { timestamp, moduleId, instructionType, data });
subscriber.next({ ack: { sessionId: msg.sessionId, ... } });
```

`getActiveSession(userId)` returns `getSoleChild(userId)` — **undefined when there are zero or ≥2 children** (`activity-session-store.service.ts:132-136`). So the controller:
- rejects every sample with `NO_SESSION` while two activities run concurrently (sole-child is undefined),
- rejects a root-tagged mark (`msg.sessionId === root.id` never equals the sole child's id) with `SESSION_MISMATCH`.

This is the anti-pattern: it validates "the single active session," not **ownership**.

## The change
Replace single-session resolution with an **ownership check**: accept `msg.sessionId` iff it is a live session owned by this user (any child, or the root); reject only when it is not owned / not live.

```ts
if (!msg.sessionId) { emitError('INVALID_ARGUMENT', 'Missing sessionId'); return; }

const session = this.activityEngine.getSession(userId, msg.sessionId);
if (!session) {
  emitError('SESSION_NOT_FOUND', 'No live session with this id for this user'); return;
}

const result = this.streamEngine.push(msg.sessionId, { timestamp: Number(msg.timestamp), moduleId: msg.moduleId, instructionType: msg.instructionType, data: msg.data });
subscriber.next({ ack: { sessionId: msg.sessionId, receivedCount: result.totalReceived, droppedCount: result.droppedCount, maxSamplesPerSecond: this.streamEngine.maxSamplesPerSecond, timestamp: Date.now() } });
```

- **Remove** the `getActiveSession` + `NO_SESSION` guard (`:78-89`) and the `session.sessionId !== msg.sessionId → SESSION_MISMATCH` guard (`:91-100`); both encode the retired single-session semantics.
- **Add** the ownership lookup `getSession(userId, msg.sessionId)`; a miss → a single ownership rejection.
- **Keep** the `!msg.sessionId → INVALID_ARGUMENT` hygiene guard (`:67-76`), the `push` call, the ack shape (`:102-117`), the buffer-cap warn (`:119-123`), and the `INTERNAL_ERROR` catch (`:124-136`).
- **Push is unchanged**: `streamEngine.push(msg.sessionId, …)` already keys the buffer by the supplied `sessionId`, so phases for two children land in two buffers and a root mark lands in the root buffer — no engine change.

### New rejection code
The miss is a real ownership error, not "not the single active one." Emit the literal **`'SESSION_NOT_FOUND'`** (the controller emits literal strings today — `'INVALID_ARGUMENT'`, `'INTERNAL_ERROR'` — not via `WsErrorCode`; keep that convention). Do **not** reuse `'NO_SESSION'`/`'SESSION_MISMATCH'`, whose meaning was the retired singleton check.

## Inlined contracts (self-contained — do not open other notes)
- **Add `ActivityEngine.getSession(userId: string, sessionId: string): ActivityState | undefined`** to `src/realtime/services/activity-engine.service.ts` — a thin delegate to the store, which already has it:
  ```ts
  getSession(userId: string, sessionId: string): ActivityState | undefined {
    return this.activitySessionStore.getSession(userId, sessionId);
  }
  ```
  The store method (`activity-session-store.service.ts:108-113`) resolves **child-or-root**: `getChild(userId, sessionId) ?? (getRootId(userId) === sessionId ? getRoot(userId) : undefined)`. So it returns the `ActivityState` for any owned child or the root, `undefined` otherwise. `getActiveSession`/`getSoleChild`/`listLiveSessions` already exist on the engine; `getSession` does **not** yet — add it.
- **`ActivityState`** (`src/realtime/interfaces/activity-state.interface.ts`) carries `sessionId: string` and `isPaused: boolean` among others. The controller only needs truthiness (owned & live) — it does not read fields off it.
- **`streamEngine.push(sessionId: string, sample: { timestamp: number; moduleId: string; instructionType: string; data?: ... }): { accepted, droppedCount, totalReceived }`** (`StreamEngine`, `services/stream-engine.service.ts`). Keyed by `sessionId`; pushing different ids buffers independently.
- **`StreamSample`** (proto `proto/generated/module_instruction_stream.ts`): `{ sessionId, timestamp, moduleId, instructionType, data }`. **No proto change** — generic addressing is already on the wire (`sessionId` per sample).
- **`emitError`** equivalent here is inline: `subscriber.next({ error: { code, message, timestamp: Date.now() } })`.
- Controller ctor (`:32-36`): `(streamEngine: StreamEngine, activityEngine: ActivityEngine, activeStreamRegistry: ActiveStreamRegistry)` — unchanged.

## Why this is ownership, not single-session
- **Concurrent children:** two activities (e.g. breath inside meditation) each push `breath_phase` tagged with their own child id; both ids are owned & live → both accepted, buffered separately.
- **Root marks:** the client, knowing the root id from its ROOT-start response ([[34-deliver-root-id-on-connect]]), pushes a mark tagged with `root.id`; the root is an owned live session → accepted, buffered under the root.
- **Rejection is genuine:** a `sessionId` not in the user's bucket (someone else's session, or a dead/unknown id) → `SESSION_NOT_FOUND`. This is the only rejection; "not the sole active child" is no longer an error.

## Guards / gotchas
- Pause does **not** block instruction ingest — the controller has no `SESSION_PAUSED` branch; a `breath_phase` for a paused-but-owned session still pushes and acks. Preserve that (characterization pause pass-through, `spec :109-217`).
- Do not add a buffer-cap or pause check that wasn't there. Only swap the resolution guard.
- No engine change, no proto change, no migration.

## Verify
- Two live children → phases for **both** child ids accepted (two `push` calls, two acks), neither rejected.
- A mark tagged with the root id → accepted (`push(root.id, …)`).
- A `sessionId` not owned by the user → `SESSION_NOT_FOUND`, no `push`.
- Missing `sessionId` → `INVALID_ARGUMENT` (unchanged).
- A paused owned session's `breath_phase` → still acked (no `SESSION_PAUSED`).

## Anti-targets (handled by the corrective test task, not here)
T3 ([[33-test-instruction-ownership]], committed `e15674a`) already added the ownership target cases and a dual-method mock factory: `module-instruction-stream.grpc.controller.spec.ts:42-46` now exposes **both** `getActiveSession` and `getSession`. What remains is the pause pass-through suite — specifically the **three cases that push a sample** (`:113/:135/:159`), which still seed only `getActiveSession` (`:115/:137/:161`) — so when this feature swaps the controller resolver to `getSession`, those characterization cases lose their stub and false-RED. (The fourth pause case, `:183`, only asserts the synchronous `ready` frame and pushes nothing, so it never hits the resolver — not at risk.) That fix is a **committed-test change → its own task**: [[38-test-instruction-pause-dual-mock]] dual-seeds both methods. Do **not** edit the frozen T3 note 33. There is no committed test asserting the retired `NO_SESSION`/`SESSION_MISMATCH` frames (the spec covers only auth + pause + ownership), so those guards are simply deleted with no test to invert.
