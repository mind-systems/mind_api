# Plan: Rename `TelemetrySample` → `InstructionSample`

## Context
Rename the `TelemetrySample` interface to `InstructionSample` across the interface definition and all consumers to align the naming with the instruction-based streaming model.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Rename

- [x] **Task 1: Rename interface in definition file**
  Files: `src/realtime/interfaces/session-buffer.interface.ts`
  Rename `TelemetrySample` to `InstructionSample` on line 1 (interface declaration) and line 8 (`samples: TelemetrySample[]` → `samples: InstructionSample[]`). Keep the shape and `extends Record<string, unknown>` unchanged.

- [x] **Task 2: Update import and usage in stream-engine service**
  Files: `src/realtime/services/stream-engine.service.ts`
  Update the import on line 15 from `TelemetrySample` to `InstructionSample`. Update the `push` method signature on line 82 from `sample: TelemetrySample` to `sample: InstructionSample`.

- [x] **Task 3: Update import and usage in stream-engine spec**
  Files: `src/realtime/services/stream-engine.service.spec.ts`
  Update the import on line 3 from `TelemetrySample` to `InstructionSample`. Update the `makeSample` helper return type on line 33 from `TelemetrySample` to `InstructionSample`.
