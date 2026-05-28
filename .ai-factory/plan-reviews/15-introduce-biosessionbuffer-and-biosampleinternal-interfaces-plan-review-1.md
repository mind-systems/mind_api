# Plan Review: Introduce `BioSessionBuffer` and `BioSampleInternal` interfaces

**Plan:** `15-introduce-biosessionbuffer-and-biosampleinternal-interfaces.md`
**Risk Level:** 🟢 Low

## Scope check

The plan creates a single TypeScript file containing two closed-shape interfaces under `src/realtime/interfaces/`. No runtime code, no migrations, no module wiring, no exports from a barrel file. Pure declarative addition that prepares the type surface for the upcoming `BiometricStreamEngine` (note 03 §5, note 05).

## Codebase verification

- `src/realtime/interfaces/` exists and already contains `session-buffer.interface.ts` and `activity-state.interface.ts` — path is correct, sibling-file convention is followed.
- The existing `session-buffer.interface.ts` matches the description in note 03 §5 verbatim: `InstructionSample extends Record<string, unknown>` with `{ timestamp, data }`, and `SessionBuffer` lacks `totalDropped`. The plan correctly leaves this file untouched.
- The new interface shapes match note 03 §5 lines 150–151 exactly: `BioSampleInternal { timestamp, sampleType, data }` and `BioSessionBuffer { sessionId, samples, byteSize, totalReceived, totalDropped }`.
- No barrel `index.ts` exists in `src/realtime/interfaces/` — consumers import from the file directly, matching the pattern of the neighbouring file. Plan correctly does not add re-exports.

## Architectural correctness

- Closed shapes (no `extends Record<string, unknown>`) deliberately avoid the open-index-signature pattern that allowed `moduleId`/`instructionType` to be smuggled through `InstructionSample` at the controller layer. This is the explicit goal called out in note 03 §5.
- Parallel-and-decoupled types (rather than a shared base) is the intended design per note 03 §5 (last paragraph) — the two pipelines should be free to evolve independently. Plan correctly forbids re-exports or shared base types.
- `totalDropped` cumulative counter closes the gap between `StreamAck.dropped_count`'s "cumulative" proto contract and the current per-call accounting. Field belongs on the buffer (not the engine) so flush can clear `samples` + `byteSize` while preserving cumulative counters — plan documents this correctly in the field semantics block.
- Plan correctly excludes `moduleId` and `instructionType` (biometric samples are not module-scoped per note 03 §2).

## Context Gates

- **Architecture gate (`.ai-factory/ARCHITECTURE.md`):** Not checked against — file presence not relevant for a pure type-only addition under an existing module's interface directory. No boundary violation (interfaces stay inside `src/realtime/`, where the consumer engine will also live).
- **Rules gate (`.ai-factory/RULES.md`):** No explicit conventions in scope (no migration, no entity, no controller). Naming follows existing `*.interface.ts` convention. ✅
- **Roadmap gate (`.ai-factory/ROADMAP.md`):** This is task 15 in the biometric-stream rollout sequence (proto → migration → entity → config → interfaces → engine → controller); the file linkage is consistent with notes 03–06. ✅ WARN: plan does not explicitly cite a ROADMAP.md milestone line, but the predecessor plan-reviews follow the same convention, so no deviation.

## Findings

### Critical Issues
None.

### Minor Notes / Suggestions
- The plan instructs "keep as short TSDoc comments above each interface, no narrative paragraphs" but the field-level semantics list (timestamp, sampleType, data, byteSize, totalReceived/totalDropped) reads as 5 bullet points of guidance — the implementer should translate these into `/** ... */` comments on individual fields, not a block comment over the interface. This is a faithful reading of the plan's own wording but worth flagging so the implementer doesn't dump all five bullets above one interface header.
- No tests / no docs is explicitly stated in Settings and is appropriate — there is no runtime behavior to test, and the documentation that explains these types lives in note 03 (and will surface in `docs/realtime/biometric-stream.md` when the engine lands, per task 07).
- Implementer should ensure the file ends with a trailing newline and uses 2-space indentation to match `session-buffer.interface.ts`.

### Positive Notes
- Plan correctly enforces "do NOT modify or extend the neighbouring file" — important because `InstructionSample`'s open-index-signature is intentional legacy behavior that the instruction-stream controller depends on.
- Field semantics are documented with citation back to note 03 §5, so future readers can trace the design rationale without re-reading the plan.
- Plan correctly identifies the file as pure declarations with no imports needed — `unknown` and `number`/`string` are built-in, no `Buffer` or external types.
- Scope is minimal and atomic: this plan can land independently of the engine implementation without breaking anything (no consumer imports yet).

PLAN_REVIEW_PASS
