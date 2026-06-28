# Test plan — bio ingest bound to root (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[10-bio-ingest-to-root]].

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
- should resolve the user's root and push the batch with `root.id` — target→10
- should reject a batch whose `session_id` is a child id (not the root) with `SESSION_MISMATCH` — target→10
- should reject with `NO_ROOT_SESSION` when the user has no root — target→10
### Lifecycle flush
- should flush + clear the per-root buffer on root ABANDONED — target→10
- should flush on REVOKED (closeAll) — target→10
- should be a harmless no-op on a child COMPLETED (child owns no bio buffer) — target→10
### Unchanged
- should still reject empty / inconsistent-sessionId / missing-sampleType batches — char
- should still increment `dropped_count` on buffer overflow without breaking temporal density — char

## Gotchas
- The engine's `@OnEvent` handlers are keyed by sessionId — they fire for the root only if the root emits ABANDONED/REVOKED with its own id (depends on [[04-lazy-root-creation]] root lifecycle).
- `pushBatch` continues (not breaks) on a per-sample overflow — preserve that assertion.
- Pause does not block bio — assert a batch is accepted for a live root regardless of `isPaused`.

## Findings
_(fill during test-writing; escalate to [[10-bio-ingest-to-root]] before implementing it)_
