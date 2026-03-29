# Plan: Update module registration

## Context
Rename the gRPC controller import in `RealtimeModule` from the old `ModuleStreamGrpcController` (path `./module-stream.grpc.controller`) to the new `ModuleInstructionStreamGrpcController` (path `./module-instruction-stream.grpc.controller`) so the module registers the renamed controller.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Update import and controller registration

- [x] **Task 1: Update controller import and registration in RealtimeModule**
  Files: `src/realtime/realtime.module.ts`
  In `realtime.module.ts`:
  1. Change the import path from `'./module-stream.grpc.controller'` to `'./module-instruction-stream.grpc.controller'`.
  2. Rename the imported symbol from `ModuleStreamGrpcController` to `ModuleInstructionStreamGrpcController`.
  3. In the `@Module({ controllers: [...] })` array, replace `ModuleStreamGrpcController` with `ModuleInstructionStreamGrpcController`.

  **Note:** As of the last exploration (2026-03-29), the file already contains the target state — the import on line 18 and the controllers array on line 25 already reference `ModuleInstructionStreamGrpcController` from `'./module-instruction-stream.grpc.controller'`. Verify and confirm no further changes are needed.
