# Plan: Drop the bio echo-match; store under the server-resolved root

## Context
Bio ingest always binds to the user's server-resolved root, so the echo-match check against the client-supplied `session_id` (controller step 6) guards nothing — remove it so a child/stale echo is accepted and stored under `root.id` instead of rejected `SESSION_MISMATCH`. (Roadmap phase a2, spec `.ai-factory/notes/35-generalize-bio-ingest-ownership.md`.)

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Make bio ingest owner-resolved

- [x] **Task 1: Delete the echo-match step from the bio batch handler**
  Files: `src/realtime/module-biometric-stream.grpc.controller.ts`
  In `handleBatch`, delete step 6 entirely — the block at lines `124-131`:
  ```ts
  // Step 6: session ID must match root session id
  if (root.id !== batch.samples[0].sessionId) {
    emitError(
      WsErrorCode.SESSION_MISMATCH,
      'Session ID does not match root session',
    );
    return;
  }
  ```
  Keep everything else exactly as-is:
  - Steps 1–4 (batch hygiene, all emit `'INVALID_ARGUMENT'`): empty batch, missing `sessionId`, inconsistent `sessionId` across samples, missing `sampleType`.
  - Step 5 (`:117-122`): `root = await this.activityEngine.ensureRoot(userId)` plus the `if (!root) emitError(WsErrorCode.NO_ROOT_SESSION, …); return;` defensive guard.
  - Happy path (`:133-150`): `pushBatch(root.id, mapped)` and ack `sessionId: root.id`, `droppedCount: result.totalDropped`. The client echo (`batch.samples[0].sessionId`) is now ignored for owner resolution.
  After removal, `WsErrorCode.SESSION_MISMATCH` is no longer referenced in this file. `WsErrorCode` is still used (step 5 emits `WsErrorCode.NO_ROOT_SESSION`), so keep the import on line 21 — do not touch it. Do not rename methods, change DI, the engine, flush mechanics, or pause behavior (pause does not block bio — unchanged). No proto change, no migration.

- [x] **Task 2: Confirm the bio ownership test suite turns GREEN** (depends on Task 1)
  Files: `src/realtime/module-biometric-stream.grpc.controller.spec.ts`
  No edits expected — the anti-target was already inverted in the completed test task (note 32, roadmap line 66): the child-id/stale-echo case now asserts acceptance and `pushBatch(root.id, …)`, and was committed RED. Run `npx jest src/realtime/module-biometric-stream.grpc.controller.spec.ts` and confirm: the inverted child/stale-echo case passes (accepted, stored under `root.id`), and the characterization cases stay GREEN — correct-root echo, `NO_ROOT_SESSION`, paused-root, batch-hygiene `INVALID_ARGUMENT` (empty / missing / inconsistent `sessionId`, missing `sampleType`), and overflow `droppedCount`. If any of these characterization cases regress, that is a Class-B signal — stop and escalate, do not patch the test.
