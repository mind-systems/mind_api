# Code Review: Tests — bio ingest ownership, not echo-match

**Scope:** test-only change to `src/realtime/module-biometric-stream.grpc.controller.spec.ts`
(plus plan/roadmap bookkeeping files). No production code, proto, or migration touched.
**Risk Level:** 🟢 Low

## What changed

Three edits inside `describe('streamData — bio bound to root')`:

1. The anti-target case (formerly `… should reject a batch whose session_id is a child id with
   SESSION_MISMATCH`) is inverted into a RED target asserting acceptance: `child-9` echo →
   `frame.ack` defined, no error, `ack.sessionId === 'root-1'`, `pushBatch('root-1', any[])`.
2. A second RED target for an arbitrary echo (`makeBatch('whatever')`) with the same acceptance
   assertions.
3. A characterization case asserting overflow surfaces via the ack (`pushBatch` overridden to
   `totalDropped: 1` → `ack.droppedCount === 1`).

## Correctness verification

Traced every changed/added test against the live controller
(`module-biometric-stream.grpc.controller.ts`):

- **Task 1 / Task 2 (RED targets):** `ensureRoot → root-1`; batch echoes `child-9` / `whatever`;
  batch-hygiene steps 1–4 pass; step 5 resolves the root; step 6 (`:124-131`) fires
  `SESSION_MISMATCH` because `root.id !== samples[0].sessionId`, and `pushBatch` is not reached.
  Today the acceptance assertions fail on a captured **error** frame → clean RED, no hang
  (`firstNonReadyFrame` resolves on the first non-`ready` frame, which is the error). When note 35
  deletes step 6, both batches push under `root.id` and ack `root-1` → GREEN. The RED→GREEN pivot
  is therefore observable at the mocked `pushBatch` spy and `ack.sessionId`, exactly the vantage
  the test asserts. ✓
- **Task 3 (characterization, GREEN now and after):** `root-1` echo matches step 6, reaches
  `pushBatch`; the per-test `mockReturnValue` yields `totalDropped: 1`; the controller acks
  `droppedCount: result.totalDropped` (`:146`), so `ack.droppedCount === 1` holds. Step-6 removal
  does not affect a matching echo, so it stays GREEN post-feature. ✓

- **Mock isolation:** `beforeEach` reconstructs `streamEngine = makeStreamEngine()` per test, so the
  Task 3 `mockReturnValue` override cannot leak into the other cases. ✓
- **Anti-target uniqueness:** after the edit, `SESSION_MISMATCH` no longer appears in this spec —
  the single committed occurrence was the one inverted, matching the note's "exactly one such case"
  claim. ✓
- **Kept-GREEN cases untouched:** correct-root push (`:255-274`), `NO_ROOT_SESSION` (`:316-331`),
  paused-root (`:333-351`), and batch-hygiene smoke (`:183-248`) are unchanged. ✓

No type mismatches (the `pushBatch` mock return matches the engine result shape the controller
reads), no race conditions (single batch per `request$`, awaited microtask), no runtime breakage.

## Non-blocking note (cosmetic, no fix required)

- **Label format drift.** The two new targets use `[RED until note 35]` while the sibling cases in
  the same block use `[RED until spec 10-bio-ingest-to-root]`. Both resolve to real notes; this is
  purely a grep/visual-consistency nicety already raised in the plan review. Not a defect.

The non-null assertions (`frame.ack!.sessionId`, `frame.ack!.droppedCount`) follow the established
spec convention; the RULES.md `!` ban targets production code, not test assertions.

REVIEW_PASS
