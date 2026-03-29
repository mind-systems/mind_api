# Plan: Rename file and class

## Context
Rename `ModuleStreamGrpcController` to `ModuleInstructionStreamGrpcController` and its file to match, aligning the class/file names with the already-updated proto service names (`ModuleInstructionStreamServiceController`).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Rename

- [x] **Task 1: Rename file and class**
  Files: `src/realtime/module-stream.grpc.controller.ts` → `src/realtime/module-instruction-stream.grpc.controller.ts`
  Rename the file from `module-stream.grpc.controller.ts` to `module-instruction-stream.grpc.controller.ts`. Inside the file, rename the class `ModuleStreamGrpcController` to `ModuleInstructionStreamGrpcController`. The `Logger` constructor already uses `ModuleStreamGrpcController.name` — it will automatically pick up the new class name, no string change needed. The `implements ModuleInstructionStreamServiceController` interface and `@ModuleInstructionStreamServiceControllerMethods()` decorator are already correct — do not change them.

- [x] **Task 2: Update import in realtime module** (depends on Task 1)
  Files: `src/realtime/realtime.module.ts`
  Update the import path from `'./module-stream.grpc.controller'` to `'./module-instruction-stream.grpc.controller'` and rename the imported symbol from `ModuleStreamGrpcController` to `ModuleInstructionStreamGrpcController`. Update the `controllers` array reference accordingly (line 25).
