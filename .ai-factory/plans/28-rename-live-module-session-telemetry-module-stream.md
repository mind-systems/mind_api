# Plan: Rename `/live` → `module_session`, `/telemetry` → `module_stream`

## Context
Rename the two gRPC streaming services (`LiveService` → `ModuleSessionService`, `TelemetryService` → `ModuleStreamService`) and all related proto definitions, generated stubs, controller files, and documentation references to communicate the modular architecture more clearly.

## Settings
- Testing: no
- Logging: minimal
- Docs: yes (update existing socket docs)

## Tasks

### Phase 1: Proto contract rename

- [x] **Task 1: Rename and update `live.proto` → `module_session.proto`**
  Files: `proto/live.proto` → `proto/module_session.proto`
  Rename the file. Inside, update:
  - `service LiveService` → `service ModuleSessionService`
  - `rpc LiveSession(stream LiveRequest) returns (stream LiveResponse)` → `rpc SessionStream(stream SessionRequest) returns (stream SessionResponse)`
  - `message LiveRequest` → `message SessionRequest`
  - `message LiveResponse` → `message SessionResponse`
  - Update all comments that reference `LiveRequest`, `LiveResponse`, `LiveService`, `LiveSession` to use new names.
  - Line 81 comment `"This message is top-level so telemetry.proto can import it later."` → `"This message is top-level so module_stream.proto can import it later."` (references the old filename, not a symbol name — easy to miss).
  - Keep domain messages unchanged: `ActivityStartCmd`, `ActivityEndCmd`, `ActivityStopCmd`, `ActivityPauseCmd`, `ActivityResumeCmd`, `PresenceCmd`, `SessionStateEvent`, `SessionErrorEvent`, and all enums (`ActivityType`, `PresenceState`, `SessionStatus`) stay as-is — these are domain concepts, not namespace names.

- [x] **Task 2: Rename and update `telemetry.proto` → `module_stream.proto`** (depends on Task 1)
  Files: `proto/telemetry.proto` → `proto/module_stream.proto`
  Rename the file. Inside, update:
  - `import "live.proto"` → `import "module_session.proto"`
  - `service TelemetryService` → `service ModuleStreamService`
  - `rpc StreamTelemetry(stream TelemetryData) returns (stream TelemetryResponse)` → `rpc StreamData(stream StreamSample) returns (stream StreamResponse)`
  - `message TelemetryData` → `message StreamSample`
  - `message TelemetryAck` → `message StreamAck`
  - `message TelemetryResponse` → `message StreamResponse`
  - Update all comments referencing old names.

- [x] **Task 3: Update `sync.proto` cross-reference comment** (depends on Task 1)
  Files: `proto/sync.proto`
  Line 44 has a comment referencing `live.proto / telemetry.proto` as naming convention examples. Update to `module_session.proto / module_stream.proto`.

- [x] **Task 4: Regenerate TypeScript stubs** (depends on Tasks 1-3)
  Files: `proto/generated/live.ts` → deleted, `proto/generated/telemetry.ts` → deleted, new `proto/generated/module_session.ts`, `proto/generated/module_stream.ts`
  Run `npm run proto:gen` to regenerate all stubs from the updated proto files. Delete the old `proto/generated/live.ts` and `proto/generated/telemetry.ts` if the generator does not clean them automatically (the glob `./proto/*.proto` will pick up the new file names but won't remove stale outputs).

### Phase 2: Backend code adaptation

- [x] **Task 5: Rename and update the session lifecycle controller** (depends on Task 4)
  Files: `src/realtime/live-stream.grpc.controller.ts` → `src/realtime/module-session.grpc.controller.ts`
  Rename the file. Inside, update:
  - Import path: `../../proto/generated/live` → `../../proto/generated/module_session`
  - Imported symbols: `LiveRequest` → `SessionRequest`, `LiveResponse` → `SessionResponse`, `LiveServiceController` → `ModuleSessionServiceController`, `LiveServiceControllerMethods` → `ModuleSessionServiceControllerMethods`
  - Class name: `LiveStreamGrpcController` → `ModuleSessionGrpcController`
  - Decorator: `@LiveServiceControllerMethods()` → `@ModuleSessionServiceControllerMethods()`
  - `implements LiveServiceController` → `implements ModuleSessionServiceController`
  - Method name: `liveSession(...)` → `sessionStream(...)` (must match the RPC name in camelCase)
  - All type references in method signatures and the body: `LiveRequest` → `SessionRequest`, `LiveResponse` → `SessionResponse`
  - Error message string: `'Empty LiveRequest — no command set'` → `'Empty SessionRequest — no command set'`
  - Logger context name updates automatically via `ModuleSessionGrpcController.name`.

- [x] **Task 6: Rename and update the stream data controller** (depends on Task 4)
  Files: `src/realtime/telemetry-stream.grpc.controller.ts` → `src/realtime/module-stream.grpc.controller.ts`
  Rename the file. Inside, update:
  - Import path: `../../proto/generated/telemetry` → `../../proto/generated/module_stream`
  - Imported symbols: `TelemetryData` → `StreamSample`, `TelemetryResponse` → `StreamResponse`, `TelemetryServiceController` → `ModuleStreamServiceController`, `TelemetryServiceControllerMethods` → `ModuleStreamServiceControllerMethods`
  - Class name: `TelemetryStreamGrpcController` → `ModuleStreamGrpcController`
  - Decorator: `@TelemetryServiceControllerMethods()` → `@ModuleStreamServiceControllerMethods()`
  - `implements TelemetryServiceController` → `implements ModuleStreamServiceController`
  - Method name: `streamTelemetry(...)` → `streamData(...)` (must match RPC name in camelCase)
  - All type references in method signatures and the body: `TelemetryData` → `StreamSample`, `TelemetryResponse` → `StreamResponse`
  - Log message: `"Unexpected error handling telemetry sample"` → `"Unexpected error handling stream sample"`

- [x] **Task 7: Update `main.ts` proto paths** (depends on Tasks 1-2)
  Files: `src/main.ts`
  In the `protoPath` array, update:
  - `join(process.cwd(), 'proto', 'live.proto')` → `join(process.cwd(), 'proto', 'module_session.proto')`
  - `join(process.cwd(), 'proto', 'telemetry.proto')` → `join(process.cwd(), 'proto', 'module_stream.proto')`

- [x] **Task 8: Update `realtime.module.ts` imports** (depends on Tasks 5-6)
  Files: `src/realtime/realtime.module.ts`
  Update:
  - `import { LiveStreamGrpcController } from './live-stream.grpc.controller'` → `import { ModuleSessionGrpcController } from './module-session.grpc.controller'`
  - `import { TelemetryStreamGrpcController } from './telemetry-stream.grpc.controller'` → `import { ModuleStreamGrpcController } from './module-stream.grpc.controller'`
  - In the `controllers` array: `LiveStreamGrpcController` → `ModuleSessionGrpcController`, `TelemetryStreamGrpcController` → `ModuleStreamGrpcController`

### Phase 3: Documentation update

- [x] **Task 9: Update socket and sync docs with new service names** (depends on Tasks 1-2)
  Files: `docs/socket/protocol.md`, `docs/socket/session-lifecycle.md`, `docs/socket/telemetry-model.md`, `docs/socket/database.md`, `docs/socket/overview.md`, `docs/socket/configuration.md`, `docs/sync/sync.md`
  These docs are in Russian and describe the old Socket.IO architecture. Replace namespace and class references only — do not rewrite the docs:
  - `protocol.md`: rename heading "Пространство имён `/live`" → "Сервис `ModuleSessionService`" (or `module_session`); rename "Пространство имён `/telemetry`" → "Сервис `ModuleStreamService`" (or `module_stream`); update any inline `/live` and `/telemetry` references.
  - `session-lifecycle.md`: replace `/live` → `module_session`, `/telemetry` → `module_stream` in text.
  - `telemetry-model.md`: replace `TelemetryGateway` → `ModuleStreamGrpcController`, `/telemetry` → `module_stream` in text.
  - `database.md`: replace `/telemetry` → `module_stream` if referenced.
  - `overview.md`: replace `LiveGateway` → `ModuleSessionGrpcController`, `TelemetryGateway` → `ModuleStreamGrpcController`, `/live` → `module_session`, `/telemetry` → `module_stream` in text. Key locations: line 13 (Transport Layer — `LiveGateway`), line 25 (modular structure — `LiveGateway`, `TelemetryGateway`).
  - `configuration.md`: replace `LiveGateway` → `ModuleSessionGrpcController` in line 15 (rate limit description).
  - `sync.md`: replace `/live` → `module_session` in line 58 ("подключён к `/live`") and line 84 ("полный список событий `/live`").

### Phase 4: Consumer notification

- [x] **Task 10: Document required consumer updates**
  Files: none (informational task)
  This rename changes gRPC service routing paths (`/mind.LiveService/LiveSession` → `/mind.ModuleSessionService/SessionStream`, `/mind.TelemetryService/StreamTelemetry` → `/mind.ModuleStreamService/StreamData`). Per proto contract rules, consumers must copy updated proto files and regenerate stubs **before deployment**. Affected consumers:
  - `mind_mobile`: `proto/live.proto`, `proto/telemetry.proto`, generated Dart stubs (`live.pb.dart`, `live.pbgrpc.dart`, `telemetry.pb.dart`, `telemetry.pbgrpc.dart`), service code (`LiveSessionGrpcService.dart`, `BreathTelemetryService.dart`).
  After completing this plan, create a follow-up `mind_mobile` plan for the consumer-side rename, or coordinate the update before deploying the API changes.

## Commit Plan
- **Commit 1** (after tasks 1-4): "Rename live/telemetry proto services to module_session/module_stream and regenerate stubs"
- **Commit 2** (after tasks 5-8): "Update controllers and module wiring for renamed proto services"
- **Commit 3** (after tasks 9-10): "Update socket and sync docs with new service names"
