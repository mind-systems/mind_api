# Plan: Remove presence from proto/module_state.proto

## Context
Delete the entire Presence feature — proto definitions, NestJS service, interface, state-store field, module registration, and all controller usage — replacing the `connectedAt` tracking with a local variable.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto contract

- [x] **Task 1: Delete presence definitions from proto**
  Files: `proto/module_state.proto`
  Delete three blocks:
  1. `enum PresenceState` (lines 18–25, including the comment on line 18 referencing `presence-state.interface.ts`)
  2. `message PresenceCmd` (lines 62–65, including the comment on line 62)
  3. `PresenceCmd presence = 6;` field from the `SessionRequest` oneof (line 101)

- [x] **Task 2: Regenerate TypeScript stubs**
  Files: `proto/generated/module_state.ts`
  Run `npm run proto:gen`. The generated file is gitignored and rebuilt from the proto source — no manual edits needed. Verify `proto/generated/module_state.ts` no longer contains `PresenceCmd`, `PresenceState`, or `presence` field in `SessionRequest`.

### Phase 2: Remove NestJS implementation

- [x] **Task 3: Remove presence handling from controller** (depends on Task 2)
  Files: `src/realtime/module-state.grpc.controller.ts`
  1. Remove `PresenceCmd` and `PresenceState` from the proto import block (line 14–15).
  2. Remove `PresenceService` import (line 20) and the `presenceService` constructor parameter (line 53).
  3. Replace `this.presenceService.online(userId, userId)` (line 100) with a local `const connectedAt = Date.now();` captured inside the `setup()` closure.
  4. Replace the teardown block (lines 137–139) that calls `this.presenceService.get(userId)?.connectedAt` with a direct reference to the local `connectedAt` variable: `const connectedDurationMs = Date.now() - connectedAt;`.
  5. Remove `this.presenceService.offline(userId)` call in the teardown async block (line 142).
  6. Remove the `else if (msg.presence !== undefined)` routing branch in `routeCommand()` (lines 179–180).
  7. Delete the entire `handlePresence()` private method (lines 335–353).

- [x] **Task 4: Delete PresenceService and its spec** (depends on Task 3)
  Files: `src/realtime/services/presence.service.ts`, `src/realtime/services/presence.service.spec.ts`
  Delete both files.

- [x] **Task 5: Delete PresenceState interface** (depends on Task 4)
  Files: `src/realtime/interfaces/presence-state.interface.ts`
  Delete the file.

- [x] **Task 6: Remove presenceMap from StateStore** (depends on Task 5)
  Files: `src/realtime/state-store.ts`
  Remove `import { PresenceState } from './interfaces/presence-state.interface'` (line 2) and the `readonly presenceMap = new Map<string, PresenceState>()` field (line 6). After this change, `StateStore` will be an empty injectable class — that's fine, it may gain new fields in the future.

- [x] **Task 7: Remove PresenceService from RealtimeModule** (depends on Task 4)
  Files: `src/realtime/realtime.module.ts`
  Remove the `PresenceService` import (line 5), remove `PresenceService` from the `providers` array (line 30), and remove `PresenceService` from the `exports` array (line 38). No external consumer injects `PresenceService` — only `AppModule` imports `RealtimeModule`, and it never uses this export.

## Commit Plan
- **Commit 1** (after tasks 1–2): "Remove presence definitions from proto contract and regenerate stubs"
- **Commit 2** (after tasks 3–7): "Remove PresenceService and all presence infrastructure from NestJS"
