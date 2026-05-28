# Plan: Introduce `BioSessionBuffer` and `BioSampleInternal` interfaces

## Context
Create dedicated closed-shape interfaces for the upcoming biometric stream pipeline so it never has to share data types with the instruction-stream pipeline. The new types match the on-the-wire `BioSample` envelope exactly and add explicit `totalDropped` for cumulative drop tracking that the existing `SessionBuffer` lacks.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Interface file

- [x] **Task 1: Create `bio-session-buffer.interface.ts` with `BioSampleInternal` and `BioSessionBuffer`**
  Files: `src/realtime/interfaces/bio-session-buffer.interface.ts`
  Add a new file under `src/realtime/interfaces/` (sibling to the existing `session-buffer.interface.ts`). Export two interfaces with **closed shapes only** — no index signatures, no extends of `Record<string, unknown>`. Do NOT modify or extend `InstructionSample`/`SessionBuffer` in the neighbouring file — these are intentionally parallel, decoupled types per note 03 §5 ("Why-new-buffer-types").

  Exact shapes (per note 03 §5, lines 150-151):

  ```typescript
  export interface BioSampleInternal {
    timestamp: number;
    sampleType: string;
    data: unknown;
  }

  export interface BioSessionBuffer {
    sessionId: string;
    samples: BioSampleInternal[];
    byteSize: number;
    totalReceived: number;
    totalDropped: number;
  }
  ```

  Notes on field semantics (carry forward from note 03 so future consumers don't have to re-derive them — keep as short TSDoc comments above each interface, no narrative paragraphs):
  - `BioSampleInternal.timestamp` — client unix-ms at sample production time (not batch-send time).
  - `BioSampleInternal.sampleType` — free-string discriminator (`"cardio"`, `"emotions"`, `"nfb"`, …); non-empty enforced at the controller layer, not here.
  - `BioSampleInternal.data` — opaque jsonb-shaped payload; schema ownership stays with the producer (mobile).
  - `BioSessionBuffer.byteSize` — in-memory byte budget used by per-sample partial-accept accounting in `BiometricStreamEngine`.
  - `BioSessionBuffer.totalReceived` / `totalDropped` — cumulative since session start; engine flush clears `samples` and `byteSize` but leaves these two intact (mirrors `StreamEngine`'s `totalReceived` lifecycle, plus the new `totalDropped` counter that closes the gap described in note 03 §5).

  Do NOT add `moduleId` or `instructionType` fields — biometric samples are not module-shaped (note 03 §2). Do NOT re-export anything from `session-buffer.interface.ts`; the two pipelines stay free to evolve independently.

  File must be pure interface declarations — no runtime code, no imports needed.

<!-- orchestrator-sessions
planner: cfa67946-37dc-47b4-a65a-1c984b888e0c
elapsed: 229
implementer: 8610951f-b1f5-4731-8f8c-b37bf36a5341
-->
