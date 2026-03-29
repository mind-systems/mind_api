# Full Rename Map — Realtime Layer

**Date:** 2026-03-29
**Source:** conversation context

## Key Findings

- The rename is driven by a shift from Socket.io "live" terminology to a domain model based on `ModuleState` and `ModuleInstruction`.
- The mobile client completed its refactor first and is now the source of truth for naming.
- Proto contract must be updated to match the client — not the other way around.
- DB tables are renamed too — no production data exists, no migration needed, drop and recreate.

## Details

### Proto Files

| Current file | Target file |
|-------------|-------------|
| `proto/module_session.proto` | `proto/module_state.proto` |
| `proto/module_stream.proto` | `proto/module_instruction_stream.proto` |

Generated stubs on mobile after regen:
- `live.pb.dart` / `live.pbgrpc.dart` → `module_state.pb.dart`
- `telemetry.pb.dart` / `telemetry.pbgrpc.dart` → `module_instruction_stream.pb.dart`

### Proto Services & RPCs

| Current | Target |
|---------|--------|
| `ModuleSessionService` | `ModuleStateService` |
| `ModuleStreamService` | `ModuleInstructionStreamService` |
| `rpc SessionStream` | `rpc TrackActivity` (lower priority) |

### Proto Message Fields

| Location | Current | Target |
|----------|---------|--------|
| `module_state.proto` — `SessionStateEvent` | `live_session_id` | `module_session_id` |

Lower priority (separate task — internal proto type names):
- `SessionRequest` → can stay (gRPC convention)
- `SessionResponse` → can stay
- `SessionStatus` → can stay
- `SessionStateEvent` → can stay

### NestJS (mind_api) — Entities & DB

| Current | Target |
|---------|--------|
| `LiveSession` (class) | `ModuleSession` |
| `live-session.entity.ts` | `module-session.entity.ts` |
| `@Entity('live_sessions')` | `@Entity('module_sessions')` |
| `liveSessionId` column in `SessionStreamSample` | `moduleSessionId` |
| `session_stream_samples.liveSessionId` (DB column) | `moduleSessionId` |
| `live_sessions` table (DB) | `module_sessions` |
| `live_sessions_status_enum` (DB enum) | `module_sessions_status_enum` |

### NestJS (mind_api) — Code

| Current | Target |
|---------|--------|
| `LIVE_SESSION_PAUSED` event constant | `MODULE_SESSION_PAUSED` |
| `LIVE_SESSION_UNPAUSED` event constant | `MODULE_SESSION_UNPAUSED` |
| `live.events.ts` | `module-session.events.ts` |
| `ModuleSessionGrpcController` | `ModuleStateGrpcController` |
| `module-session.grpc.controller.ts` | `module-state.grpc.controller.ts` |
| `ModuleStreamGrpcController` | `ModuleInstructionStreamGrpcController` |
| `module-stream.grpc.controller.ts` | `module-instruction-stream.grpc.controller.ts` |
| `liveSessionId:` in all controller responses | `moduleSessionId:` |

### Dart (mind_mobile) — Core Layer

| Current | Target |
|---------|--------|
| `ModuleStateChannel` | unchanged ✓ |
| `ModuleInstructionStream` | unchanged ✓ |
| `ModuleState` | unchanged ✓ |
| `ModuleStateEvent` | unchanged ✓ |
| `InstructionSample` | unchanged ✓ |
| `InstructionAck` | unchanged ✓ |
| `InstructionBuffer` | unchanged ✓ |
| `liveSessionId` field in `ModuleState` | `moduleSessionId` |
| `proto.LiveServiceClient` (inside `ModuleStateChannel`) | `proto.ModuleStateServiceClient` (after proto regen) |
| `proto.LiveRequest` | `proto.SessionRequest` (after proto regen) |
| `proto.LiveResponse` | `proto.SessionResponse` (after proto regen) |
| `generated/live.pb.dart` import | `generated/module_state.pb.dart` (after proto regen) |
| `generated/telemetry.pb.dart` import | `generated/module_instruction_stream.pb.dart` (after proto regen) |
| `TelemetryServiceClient` | `ModuleInstructionStreamServiceClient` (after proto regen) |
| `TelemetryData` | `StreamSample` (after proto regen) |
| `TelemetryAck` | `StreamAck` (after proto regen) |
| `TelemetryResponse` | `StreamResponse` (after proto regen) |

### Dart (mind_mobile) — Breath Layer

| Current | Target |
|---------|--------|
| `BreathModuleStateChannel` | unchanged ✓ |
| `BreathModuleInstructionStream` | unchanged ✓ |
| `liveSessionId` references | `moduleSessionId` |

### Documentation

| File | Status |
|------|--------|
| `mind_api/docs/realtime/overview.md` | ✓ done |
| `mind_api/docs/realtime/session-lifecycle.md` | ✓ done |
| `mind_api/docs/realtime/telemetry-model.md` | ✓ done |
| `mind_api/docs/realtime/protocol.md` | ✓ done |
| `mind_api/docs/realtime/database.md` | needs update: `module_sessions` table name |
| `mind_mobile/docs/realtime/live-session-tracking.md` | ✓ done |

## Open Questions

- Should `SessionRequest` / `SessionResponse` / `SessionStatus` / `SessionStateEvent` in proto be renamed? (lower priority)
- Should `rpc SessionStream` → `rpc TrackActivity`?
