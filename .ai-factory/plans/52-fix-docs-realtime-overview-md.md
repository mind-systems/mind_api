# Plan: Fix `docs/realtime/overview.md`

## Context
Rename the incorrect controller name `ModuleInstructionGrpcController` to `ModuleInstructionStreamGrpcController` in the Transport Layer description.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Fix

- [x] **Task 1: Rename controller reference in overview.md**
  Files: `docs/realtime/overview.md`
  On line 11, in the «Transport Layer» paragraph, replace `ModuleInstructionGrpcController` with `ModuleInstructionStreamGrpcController`. No other changes to the file.
