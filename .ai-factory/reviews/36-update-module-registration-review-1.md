# Review: 36 — Update module registration

## Scope
Update the import path and symbol in `src/realtime/realtime.module.ts` from `ModuleStreamGrpcController` / `./module-stream.grpc.controller` to `ModuleInstructionStreamGrpcController` / `./module-instruction-stream.grpc.controller`.

## Findings

### Code changes (commit `b0a596a`)
The actual code change was made in commit `b0a596a` ("Rename file and class"), which:
1. Renamed `src/realtime/module-stream.grpc.controller.ts` → `src/realtime/module-instruction-stream.grpc.controller.ts`
2. Updated the class name from `ModuleStreamGrpcController` → `ModuleInstructionStreamGrpcController` inside the controller file
3. Updated the import path and symbol in `realtime.module.ts` (line 18)
4. Updated the `controllers` array in `realtime.module.ts` (line 25)

### Verification
- **Old file removed:** `module-stream.grpc.controller.ts` no longer exists — no stale file.
- **New file exists:** `module-instruction-stream.grpc.controller.ts` is present and exports `ModuleInstructionStreamGrpcController`.
- **Proto import resolves:** Controller imports from `../../proto/generated/module_instruction_stream`, and `proto/generated/module_instruction_stream.ts` exists.
- **Class consistency:** The controller class implements `ModuleInstructionStreamServiceController` and is decorated with `@ModuleInstructionStreamServiceControllerMethods()` — both match the renamed proto service.
- **Module registration correct:** `realtime.module.ts` imports and registers `ModuleInstructionStreamGrpcController` in the `controllers` array.

### Staged diff
The only staged change is the plan file (`.ai-factory/plans/36-update-module-registration.md`). No runtime code is staged — the code change was already committed.

## Issues found
None.

REVIEW_PASS
