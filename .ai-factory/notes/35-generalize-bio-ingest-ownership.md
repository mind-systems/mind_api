# Generalize bio ingest to ownership (F2)

**Date:** 2026-06-29
**Source:** conversation context (handoff 06-generic-session-data-flow §F2)

Feature task. Tested by [[32-test-bio-ownership]]. Depends on [[34-deliver-root-id-on-connect]] (the client can now learn the root id). Minor task. Builds on the shipped bio-root binding ([[10-bio-ingest-to-root]]).

## Decision (locked)
**Simplify to "store under the server-resolved root; ignore the client echo."** Bio is connection-level and always binds to the user's own root — which the server resolves itself from `userId` via `ensureRoot`. The client's echoed `session_id` therefore adds no information and only creates a way to falsely reject a valid batch. Drop the echo-match check (controller step 6); always push under `root.id`.

Rationale vs the alternative (keep step 6 as an ownership/consistency check): for bio there is exactly one valid owner per user (the root), and the server already holds it — a cross-check against a client-supplied id guards nothing real and, before F1, was outright unsatisfiable. The generic-ownership principle here reduces to "the owner is the user's root, period."

Trade-off (accepted): a malformed/stale client echo is silently absorbed rather than surfaced. Acceptable — bio owner is server-authoritative; batch hygiene (steps 1–4) still rejects malformed batches loudly.

## Problem today — `src/realtime/module-biometric-stream.grpc.controller.ts`
`handleBatch` (`:82-171`, private, async) runs ordered guards, then:

```ts
// Step 5 (:117-122): resolve root
const root = await this.activityEngine.ensureRoot(userId);
if (!root) { emitError(WsErrorCode.NO_ROOT_SESSION, 'No root session'); return; }

// Step 6 (:124-131): echo-match — REMOVE THIS
if (root.id !== batch.samples[0].sessionId) {
  emitError(WsErrorCode.SESSION_MISMATCH, 'Session ID does not match root session');
  return;
}

// Happy path (:133-148): push under root.id, ack sessionId: root.id
const result = this.streamEngine.pushBatch(root.id, mapped);
```

So a client that echoes anything other than the exact root id is rejected `SESSION_MISMATCH`, even though the server would store under `root.id` regardless.

## The change
- **Delete controller step 6** (`:124-131`, the `root.id !== batch.samples[0].sessionId → SESSION_MISMATCH` block).
- Keep **step 5** (`:117-122`): resolve `root = await ensureRoot(userId)`; keep the `NO_ROOT_SESSION` guard for the unexpected null (defensive — `ensureRoot` almost never yields nothing).
- Happy path **unchanged**: `pushBatch(root.id, mapped)`, ack `sessionId: root.id` (`:133-148`). The client echo (`batch.samples[0].sessionId`) is now ignored for owner resolution.
- Keep **steps 1–4** (batch hygiene, all emit literal `'INVALID_ARGUMENT'`): empty batch (`:92-95`), missing sessionId `samples[0].sessionId === ''` (`:98-101`), inconsistent sessionId across samples (`:104-109`), missing sampleType (`:112-115`). These guard malformed batches independent of ownership — untouched.

## Inlined contracts (self-contained — do not open other notes)
- **`activityEngine.ensureRoot(userId, clientTs?): Promise<ModuleSession | undefined>`** — user's root (lazily created), owner field `root.id` (uuid PK, no `sessionId` field on the entity).
- **`WsErrorCode`** (`src/realtime/constants/ws-error-codes.ts`): `NO_ROOT_SESSION === 'NO_ROOT_SESSION'`, `SESSION_MISMATCH === 'SESSION_MISMATCH'` (literal values). The controller already imports `WsErrorCode` (`:21`) and emits `WsErrorCode.NO_ROOT_SESSION` at step 5.
- **`streamEngine.pushBatch(sessionId: string, mapped: BioSampleInternal[])`** (`BiometricStreamEngine`, `biometric-stream-engine.service.ts:77`) — keyed by an arbitrary `sessionId`; passing `root.id` buffers per-root automatically. Returns `{ acceptedCount, droppedCount, totalReceived, totalDropped }`; controller acks `droppedCount: result.totalDropped`.
- **`emitError`** is a local closure in `handleBatch`: `(code, message) => subscriber.next({ error: { code, message, timestamp: Date.now() } })`.

## Guards / gotchas
- Engine and flush mechanics **unchanged** — no `@OnEvent` or buffer-key edits. Bio still persists to `bio_session_samples` with `moduleSessionId = root.id`.
- Pause does not block bio — a live root accepts a batch regardless of `isPaused` (unchanged).
- No proto change. No migration.

## Verify
- Batch echoing the correct root id → accepted, stored under `root.id` (unchanged).
- Batch echoing a child id / stale id / any non-root id → **now accepted** and stored under `root.id` (was `SESSION_MISMATCH`).
- Batch with an empty/inconsistent sessionId or missing sampleType → still rejected `INVALID_ARGUMENT`.
- `ensureRoot` yields nothing → `NO_ROOT_SESSION` (defensive path).

## Anti-targets
The committed bio test asserting a child-id echo → `SESSION_MISMATCH` (shipped GREEN from [[10-bio-ingest-to-root]] / [[21-test-bio-ingest-to-root]], in `src/realtime/module-biometric-stream.grpc.controller.spec.ts`) must be **inverted** to assert acceptance. Enumerated by file:line and inverted in [[32-test-bio-ownership]].
