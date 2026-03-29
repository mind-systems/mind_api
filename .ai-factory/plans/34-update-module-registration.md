# Plan: Update module registration

## Context
Rename the gRPC controller import in `RealtimeModule` from `ModuleSessionGrpcController` (file `module-session.grpc.controller`) to `ModuleStateGrpcController` (file `module-state.grpc.controller`) and update the `controllers` array accordingly.

**Note:** As of the latest inspection, `src/realtime/realtime.module.ts` already contains the target state — the import points to `'./module-state.grpc.controller'`, the symbol is `ModuleStateGrpcController`, and it appears in the `controllers` array (lines 17, 25). If the file has not regressed, this milestone requires no changes.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Update module registration

- [x] **Task 1: Update controller import and registration in RealtimeModule**
  Files: `src/realtime/realtime.module.ts`
  1. Change the import path from `'./module-session.grpc.controller'` to `'./module-state.grpc.controller'`.
  2. Rename the imported symbol from `ModuleSessionGrpcController` to `ModuleStateGrpcController`.
  3. In the `@Module({ controllers: [...] })` array, replace `ModuleSessionGrpcController` with `ModuleStateGrpcController`.
  4. Verify the file `src/realtime/module-state.grpc.controller.ts` exists and exports `ModuleStateGrpcController` — if not, the rename from a prior milestone may be missing.
