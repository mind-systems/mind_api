# Implementation Plan: Update Proto Contract (Phase 7.1)

Branch: grpc
Created: 2026-03-29

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Overview

Rename the two realtime proto files and their services to align with the modular architecture naming:

| Old | New |
|-----|-----|
| `proto/module_session.proto` | `proto/module_state.proto` |
| `service ModuleSessionService` | `service ModuleStateService` |
| `rpc SessionStream` | `rpc TrackActivity` |
| `field live_session_id` (in `SessionStateEvent`) | `field module_session_id` |
| `proto/module_stream.proto` | `proto/module_instruction_stream.proto` |
| `service ModuleStreamService` | `service ModuleInstructionStreamService` |
| import `"module_session.proto"` in module_stream | import `"module_state.proto"` |

After renaming, regenerate TypeScript stubs and update all NestJS controller imports and wiring.

## Commit Plan

- **Commit 1** (after tasks 1–5): `refactor: rename module_session → module_state and module_stream → module_instruction_stream proto contracts`

## Tasks

### Phase 1: Rename proto files

- [x] **Task 1: Rename `proto/module_session.proto` → `proto/module_state.proto`**

  Copy `proto/module_session.proto` to `proto/module_state.proto`, then delete the original.

  Changes inside the new file:
  - `service ModuleSessionService` → `service ModuleStateService`
  - `rpc SessionStream(stream SessionRequest) returns (stream SessionResponse)` → `rpc TrackActivity(stream SessionRequest) returns (stream SessionResponse)`
  - Inside `SessionStateEvent`: rename field `string live_session_id = 1` → `string module_session_id = 1` (field number stays `1`)

  No other message names change.

  Files: `proto/module_state.proto` (new), `proto/module_session.proto` (delete)

  LOGGING: no logging required — file rename only.

- [x] **Task 2: Rename `proto/module_stream.proto` → `proto/module_instruction_stream.proto`**

  Copy `proto/module_stream.proto` to `proto/module_instruction_stream.proto`, then delete the original.

  Changes inside the new file:
  - Line 6 import: `import "module_session.proto"` → `import "module_state.proto"`
  - `service ModuleStreamService` → `service ModuleInstructionStreamService`

  No message names change.

  Files: `proto/module_instruction_stream.proto` (new), `proto/module_stream.proto` (delete)

  LOGGING: no logging required — file rename only.

### Phase 2: Update protoPath registration

- [x] **Task 3: Update `src/main.ts` — protoPath array**

  In `src/main.ts`, find the `protoPath` array passed to `connectMicroservice()`. It currently lists `module_session.proto` and `module_stream.proto`. Replace both entries:
  - `join(process.cwd(), 'proto', 'module_session.proto')` → `join(process.cwd(), 'proto', 'module_state.proto')`
  - `join(process.cwd(), 'proto', 'module_stream.proto')` → `join(process.cwd(), 'proto', 'module_instruction_stream.proto')`

  Files: `src/main.ts`

  LOGGING: no logging required — config change only.

### Phase 3: Regenerate TypeScript stubs

- [x] **Task 4: Run proto codegen**

  Run:
  ```bash
  npm run proto:gen
  ```

  Verify that:
  - `proto/generated/module_state.ts` is created (new)
  - `proto/generated/module_instruction_stream.ts` is created (new)
  - `proto/generated/module_session.ts` is deleted / no longer generated
  - `proto/generated/module_stream.ts` is deleted / no longer generated
  - TypeScript compiles without errors: `npm run build`

  Files: `proto/generated/` (auto-generated)

  LOGGING: no logging required.

### Phase 4: Update gRPC controller imports

- [x] **Task 5: Update `src/realtime/module-session.grpc.controller.ts` imports**

  Update the import statement at the top of the file:
  - Old: `import { ModuleSessionServiceController, ModuleSessionServiceControllerMethods, ... } from '../../proto/generated/module_session'`
  - New: `import { ModuleStateServiceController, ModuleStateServiceControllerMethods, ... } from '../../proto/generated/module_state'`

  Update usages in the class:
  - `implements ModuleSessionServiceController` → `implements ModuleStateServiceController`
  - `@ModuleSessionServiceControllerMethods()` decorator → `@ModuleStateServiceControllerMethods()`
  - Rename the RPC method: `sessionStream(...)` → `trackActivity(...)` (the method name must match the proto RPC name)
  - All seven `sessionState` response object literals that include `liveSessionId`: rename field to `moduleSessionId`
    - reconnect resume response (search for `liveSessionId` in the controller)
    - existing-session early return in `handleActivityStart`
    - session started response
    - `handleActivityEnd` response
    - `handleActivityStop` response
    - `handleActivityPause` response
    - `handleActivityResume` response

  Files: `src/realtime/module-session.grpc.controller.ts`

  LOGGING: no logging required — import/interface rename only.

- [x] **Task 6: Update `src/realtime/module-stream.grpc.controller.ts` imports**

  Update the import statement:
  - Old: `import { ModuleStreamServiceController, ModuleStreamServiceControllerMethods, ... } from '../../proto/generated/module_stream'`
  - New: `import { ModuleInstructionStreamServiceController, ModuleInstructionStreamServiceControllerMethods, ... } from '../../proto/generated/module_instruction_stream'`

  Update usages:
  - `implements ModuleStreamServiceController` → `implements ModuleInstructionStreamServiceController`
  - `@ModuleStreamServiceControllerMethods()` decorator → `@ModuleInstructionStreamServiceControllerMethods()`

  Files: `src/realtime/module-stream.grpc.controller.ts`

  LOGGING: no logging required — import/interface rename only.

### Phase 5: Verify compilation

- [x] **Task 7: Final build verification**

  Run:
  ```bash
  npm run build
  ```

  Confirm zero TypeScript errors. If errors remain, fix import/type mismatches before proceeding.

  Files: (none — verification only)

  LOGGING: no logging required.
