# Plan: Fix `docs/realtime/protocol.md`

## Context
The doc file still references the old service name `ModuleInstructionService`. The codebase was renamed to `ModuleInstructionStreamService` (see `proto/module_instruction_stream.proto`, `src/realtime/module-instruction-stream.grpc.controller.ts`). The section header and introduction need to match.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Rename

- [x] **Task 1: Rename `ModuleInstructionService` → `ModuleInstructionStreamService` in protocol.md**
  Files: `docs/realtime/protocol.md`
  Replace the two occurrences of `ModuleInstructionService` with `ModuleInstructionStreamService`:
  - **Line 3** (introduction paragraph): `…и \`ModuleInstructionService\` для потоковой…` → `…и \`ModuleInstructionStreamService\` для потоковой…`
  - **Line 26** (section header): `## \`ModuleInstructionService\`` → `## \`ModuleInstructionStreamService\``
  No other lines reference this name — `ModuleStateService` stays unchanged.
