# Plan Review: Remove module-specific pause guards from both realtime stream controllers

**Plan:** `63-remove-the-module-specific-pause-guards-from-both-realtime-stream-controllers.md`
**Files Reviewed (verification scope):** 6
**Risk Level:** 🟢 Low

## Verification Summary

Every concrete claim in the plan was checked against the live codebase and confirmed:

| Claim | Status |
|-------|--------|
| Biometric guard at `module-biometric-stream.grpc.controller.ts:132-139` (`if (session.isPaused === true) → emitError('SESSION_PAUSED', …)`) | ✅ Exact match (lines 132-139) |
| Instruction guard at `module-instruction-stream.grpc.controller.ts:103-115` (`session.isPaused && msg.instructionType === StreamDataType.BREATH_PHASE → SESSION_PAUSED`) | ✅ Exact match (lines 103-115) |
| `StreamDataType` import on line 21, used **only** by the deleted guard | ✅ Confirmed — only reference in the file is the guard at line 105 |
| `StreamDataType.SESSION_EVENT` must stay (used by `ActivityEngine`) | ✅ Constant defined in `constants/stream-data-types.ts`; `SESSION_EVENT` is independent of `BREATH_PHASE` |
| After biometric removal, control falls from Step 6 (`SESSION_MISMATCH`) into the happy path | ✅ Correct — `batchSessionId` mapping + `pushBatch` follow immediately |
| After instruction removal, control falls from `SESSION_MISMATCH` into `streamEngine.push(...)` | ✅ Correct |
| `pushBatch` result shape `{ totalReceived, totalDropped, droppedCount }` | ✅ Matches controller usage (lines 155-162) |
| `push` result shape `{ totalReceived, droppedCount, accepted }` | ✅ Matches controller usage (lines 128-134) |
| `biometric-stream.md:13` carries the "и не на паузе" precondition | ✅ Confirmed |
| `biometric-stream.md` `## Семантика паузы` section at lines 43-49 | ✅ Confirmed — describes the `SESSION_PAUSED` batch rejection to be inverted |
| `protocol.md` pause/resume rows at lines 18-19 | ✅ Confirmed — they describe only the in-memory `isPaused` toggle, imply **no** sample rejection. Task 4's "most likely no change needed" conclusion is correct |
| Spec pattern reference `module-state.grpc.controller.spec.ts` | ✅ Exists; uses direct instantiation + hand-rolled jest mocks + `Subject` driving + collected `next` values, exactly as the plan describes |
| No proto / schema / migration change | ✅ Correct — change is purely additive to acceptance (more samples stored), opaque jsonb, no contract change |

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** No boundary violation. The change *reduces* coupling by removing a `BREATH_PHASE` domain literal that leaked into a module-agnostic transport layer — aligns with the modular-monolith intent. The server `SESSION_EVENT` lifecycle injection in `ActivityEngine` is explicitly left untouched. **PASS**
- **Rules (`RULES.md`):** Logging rule (NestJS `Logger`, no `console.*`) is respected — the plan touches no logging. Migration rule is N/A (no schema change). Plan correctly flags the unused-import lint catch. **PASS**
- **Roadmap (`ROADMAP.md`):** Phase 19 established the biometric controller's "7-step validation chain" and `biometric-stream.md` pause semantics; this plan deliberately removes step 7 and rewrites that doc section, an intentional inversion driven by mind_mobile Phase 42. The work is a coherent follow-on to the realtime roadmap line. **WARN (non-blocking):** the plan does not cite a specific ROADMAP milestone/Phase entry for this change. The driving spec (`notes/49-…`) is referenced and sufficient; consider linking the roadmap milestone for traceability, but this does not block implementation.

## Critical Issues

None.

## Minor Observations (non-blocking)

1. **Instruction-spec mock fidelity.** Task 5 mocks `streamEngine.push` to return `{ totalReceived, droppedCount, accepted: true }`. The controller also reads `result.accepted` (line 134) to decide whether to warn-log; with `accepted: true` no warn path is hit, so the mock is complete. Good. Ensure the mocked session object exposes both `sessionId` (for the Step-6/`SESSION_MISMATCH` check) and `isPaused: true` — the plan states this correctly.

2. **Biometric-spec batch validity.** The pass-through assertion only succeeds if the pushed `BioSampleBatch` clears Steps 1-4 (non-empty, non-empty consistent `sessionId`, non-empty `sampleType` on every sample). The plan explicitly calls for "non-empty, consistent `sessionId`, non-empty `sampleType`" — correct. Worth keeping the batch minimal (a single valid sample) to avoid accidental tripping of the consistency checks.

3. **Doc rewrite scope discipline.** Task 3 is the largest surface. The plan's instruction to *not* introduce a `phase='resume'` literal and to frame the pause band as `[ phase='pause' marker → next real phase marker ]` matches the resolved two-axis model in note 49 §"Two-axis pause model". Reviewer of the implemented doc should verify no cross-axis time-join is implied.

## Positive Notes

- Line-accurate file/range references throughout — no drift between plan and code.
- Correctly identifies the import-removal as a compile/lint gate (`StreamDataType` becomes dangling) and bakes it into both the task and the verification section.
- Explicitly scopes out what must **not** change (Steps 1-6, `ready` emit, ack/error semantics, engine calls, `SESSION_EVENT` injection, the constant definition), which sharply limits blast radius.
- Atomic commit grouping of code + docs + regression test is sound: the doc contradicts the code the moment the guard is removed, so shipping them together prevents an interim defect.
- The regression test addresses a genuine pre-existing coverage gap (no controller spec existed for either stream controller), locking in the new behavior rather than just asserting the obvious.

PLAN_REVIEW_PASS
