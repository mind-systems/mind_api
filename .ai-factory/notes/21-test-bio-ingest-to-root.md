# Test plan — bio ingest bound to root (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[10-bio-ingest-to-root]].

## Test authoring constraints (the four lessons)
- **L1 — outcomes only:** batch-consistency rejections assert the emitted error `code` string on the captured subscriber, not the validation branch order. Overflow asserts the OUTCOME counter (`ack.droppedCount` / `result.totalDropped`), never the internal `BioSessionBuffer` `byteSize`/`samples` structure. "Pushed with root.id" asserts `streamEngine.pushBatch` was called with `root.id` (the resolved owner), not the buffer map.
- **L2 — compile-now:** `activityEngine.getRoot(userId)` does not exist yet (only `getActiveSession`, `activity-engine.service.ts:401`) — stub/access via `(engine as any).getRoot`. Root fixtures use `activityType: 'root' as any`.
- **L3 — label by spec name:** target cases `RED until spec 10-bio-ingest-to-root`; never a phase number.
- **L4 — escalation valve:** the batch-consistency and overflow cases are characterization invariants. A RED there post-spec-10 = genuine Class-B regression, escalate. Routing-to-root cases are target, expected RED now.

## Why this area (silent-failure filter)
Most validation here fails loudly (`SESSION_MISMATCH`, `NO_ROOT_SESSION`, batch-consistency errors) — those are low-priority. The **silent** parts: pushing the batch with the wrong owner id (bio attributed to a child instead of the root → invisible to the windowed read), and the flush no longer firing on the right lifecycle event (buffered bio silently lost on root teardown). Test those; the loud error paths only need a smoke check.

## Behavior under change — think hard before writing
Ingest moves from "active child" to "user's root". Trace what happens to bio when a child completes (was: flush+clear child buffer; now: child never owned a buffer — the COMPLETED handler must be a harmless no-op) and when the root is abandoned/revoked (must flush). Confirm the engine, keyed by an arbitrary sessionId, actually buffers per-root once `root.id` is passed. Any lifecycle gap → **Findings**.

## Red/Green contract
- **Target (RED until [[10-bio-ingest-to-root]]):** root resolution + flush-on-root-lifecycle.
- **Characterization (GREEN, stay GREEN):** batch-consistency rules (empty batch, missing/inconsistent sessionId, missing sampleType) still reject with the same codes; the engine's ring-buffer drop/`dropped_count` accounting on overflow is unchanged.

## Instantiation
`ModuleBiometricStreamGrpcController` with mocked `BiometricStreamEngine`, `ActivityEngine` (`getRoot` stub), `ActiveStreamRegistry`; drive a fake batch `Observable` and capture `BioStreamResponse` on a fake subscriber. `BiometricStreamEngine` separately with a mocked `Repository<BioSessionSample>` for flush/lifecycle.

## Test cases
### Routing
- should resolve the user's root and call `pushBatch(root.id, …)` — target→10
- should reject a batch whose `session_id` is a child id (not the root) with code `SESSION_MISMATCH` — target→10
- should reject with code `NO_ROOT_SESSION` when the user has no root — target→10
### Lifecycle flush
- should flush + clear the per-root buffer on root ABANDONED — target→10
- should flush on REVOKED (closeAll) — target→10
- should be a harmless no-op on a child COMPLETED (child owns no bio buffer) — target→10
### Unchanged
- should still reject empty / inconsistent-sessionId / missing-sampleType batches — char
- should still increment `dropped_count` on buffer overflow without breaking temporal density — char

## Exact pins (read from source)
- **Error codes are LITERAL strings in the controller, NOT via `WsErrorCode`:** `module-biometric-stream.grpc.controller.ts` emits `'INVALID_ARGUMENT'` (empty batch line 92; missing sessionId 98; inconsistent sessionId 106; missing sampleType 113), `'NO_SESSION'` (line 119), `'SESSION_MISMATCH'` (line 125-128), `'INTERNAL_ERROR'` (line 165). Assert these exact literals on `error.code`. `NO_ROOT_SESSION` already exists in `ws-error-codes.ts:4` (`'NO_ROOT_SESSION'`) — spec 10 will emit it when `getRoot` returns nothing (replacing the `getActiveSession` → `'NO_SESSION'` check at lines 117-119). Assert the literal `'NO_ROOT_SESSION'`.
- **Validation order (smoke only, char):** empty → missing sessionId → inconsistent sessionId → missing sampleType → no session → mismatch (controller lines 90-130). These are loud paths; assert each code once, don't over-test.
- **Overflow counter (char):** `pushBatch` returns `{ acceptedCount, droppedCount, totalReceived, totalDropped }` (`biometric-stream-engine.service.ts:77-133`); on per-sample cap it does `buffer.totalDropped += 1; droppedCount += 1; continue` (lines 113-119) — does NOT break. The controller surfaces `ack.droppedCount = result.totalDropped` (`module-biometric-stream.grpc.controller.ts:144-148`). Assert `ack.droppedCount` reflects the overflow; do not inspect `buffer.byteSize`.
- **Lifecycle flush keyed by sessionId:** `@OnEvent(ABANDONED/REVOKED/COMPLETED/INTERRUPTED)` each do `await flush(payload.sessionId); buffers.delete(payload.sessionId)` (`biometric-stream-engine.service.ts:204-250`). For the root flush to fire, the root must emit ABANDONED/REVOKED with its OWN id (depends on [[04-lazy-root-creation]] root lifecycle). A child COMPLETED is a harmless no-op because the child never owned a buffer (spec 10 ingests under root.id) — assert `flush(childId)` finds an empty/missing buffer and saves nothing.
- **Controller resolution today:** `getActiveSession(userId)` then `session.sessionId !== batch.samples[0].sessionId` → mismatch (controller lines 116-130). Spec 10 swaps to `getRoot(userId)` and compares against `root.id`.

## Instantiation
`ModuleBiometricStreamGrpcController(streamEngine, activityEngine, activeStreamRegistry)` (3 ctor args, `module-biometric-stream.grpc.controller.ts:33-37`). Drive `streamData` with a fake batch `Observable`, capture `BioStreamResponse` on a fake subscriber; or call the private `handleBatch(userId, batch, subscriber)` via `(controller as any).handleBatch`. Separately, `BiometricStreamEngine(sampleRepo, moduleSessionRepo, configService)` (3 ctor args, lines 33-39) with mocked repos for flush/lifecycle.

## Gotchas
- The engine's `@OnEvent` handlers are keyed by sessionId — they fire for the root only if the root emits ABANDONED/REVOKED with its own id (depends on [[04-lazy-root-creation]] root lifecycle).
- `pushBatch` continues (not breaks) on a per-sample overflow — preserve that assertion.
- Pause does not block bio — assert a batch is accepted for a live root regardless of `isPaused`.

## Findings
_(fill during test-writing; escalate to [[10-bio-ingest-to-root]] before implementing it)_
