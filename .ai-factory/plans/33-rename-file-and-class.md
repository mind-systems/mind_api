# Plan: Rename file and class

## Context
Rename `ModuleSessionGrpcController` to `ModuleStateGrpcController` — file, class, logger context, and module registration. The proto interface/decorator imports (`ModuleStateServiceController`, `ModuleStateServiceControllerMethods`) and the `moduleSessionId` field in all seven response literals are already correct; this plan covers the remaining class/file rename.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Rename file and class

- [x] **Task 1: Rename the file**
  Files: `src/realtime/module-session.grpc.controller.ts` -> `src/realtime/module-state.grpc.controller.ts`
  Use `git mv src/realtime/module-session.grpc.controller.ts src/realtime/module-state.grpc.controller.ts` to preserve history. No content changes in this task.

- [x] **Task 2: Rename the class and logger** (depends on Task 1)
  Files: `src/realtime/module-state.grpc.controller.ts`
  In the renamed file:
  - Line 45: rename `export class ModuleSessionGrpcController` to `export class ModuleStateGrpcController`
  - Line 46: update `new Logger(ModuleSessionGrpcController.name)` to `new Logger(ModuleStateGrpcController.name)`

- [x] **Task 3: Update module registration** (depends on Task 1)
  Files: `src/realtime/realtime.module.ts`
  - Line 17: change `import { ModuleSessionGrpcController } from './module-session.grpc.controller'` to `import { ModuleStateGrpcController } from './module-state.grpc.controller'`
  - Line 25: in the `controllers` array, replace `ModuleSessionGrpcController` with `ModuleStateGrpcController`
