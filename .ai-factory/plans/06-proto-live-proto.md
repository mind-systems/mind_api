# Plan: proto/live.proto

## Context
Define the gRPC contract for the bidirectional-streaming live session RPC — the first streaming proto in the project. This file will be the source of `SessionErrorEvent`, which `telemetry.proto` will later import.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Create live.proto

- [x] **Task 1: Define enums and shared types**
  Files: `proto/live.proto`
  Create `proto/live.proto` with `syntax = "proto3"; package mind;` header (same as all other protos).
  Add the section banner `// Shared types` and define three enums.
  All enums use the proto3 sentinel pattern: value `0` is always `*_UNSPECIFIED` to prevent uninitialized fields from silently matching a real value. This is especially important for `SessionStatus` where a default `ACTIVE` could mask bugs, but apply consistently to all three enums for uniformity.
  - `ActivityType` — `ACTIVITY_TYPE_UNSPECIFIED = 0`, `BREATH_SESSION = 1`. Maps to `src/realtime/enums/activity-type.enum.ts`. Named `BREATH_SESSION` (not `BREATH`) for 1:1 mapping with the existing TypeScript enum value `ActivityType.BREATH_SESSION`. Only one real member for now; the enum is the extension point for future activity types.
  - `PresenceState` — `PRESENCE_STATE_UNSPECIFIED = 0`, `FOREGROUND = 1`, `BACKGROUND = 2`. Maps to `src/realtime/interfaces/presence-state.interface.ts` (the existing code uses `'online' | 'background'` strings; proto uses the canonical FOREGROUND/BACKGROUND names from the roadmap).
  - `SessionStatus` — `SESSION_STATUS_UNSPECIFIED = 0`, `ACTIVE = 1`, `DISCONNECTED = 2`, `COMPLETED = 3`, `ABANDONED = 4`, `INTERRUPTED = 5`, `RESUMED = 6`. Maps to `src/realtime/enums/session-status.enum.ts`.

  Note: The existing protos (`StepType`, `TimeOfDay`, `UserRole`) don't use sentinels, but those are low-risk (a default `INHALE` or `MORNING` is obviously wrong in context). `SessionStatus` and `PresenceState` carry real operational semantics where a silent default is dangerous. Adopting sentinels here sets the better convention going forward.

- [x] **Task 2: Define command messages** (depends on Task 1)
  Files: `proto/live.proto`
  Add the section banner `// Client → server commands` and define six messages:
  - `ActivityStartCmd` — `ActivityType activity_type = 1`, `optional string ref_id = 2`, `optional string ref_type = 3`. Maps to `ActivityStartDto` in `src/realtime/dto/activity-start.dto.ts`. `ref_id` is the optional breath-session ID (`activityRefId` in the entity). `ref_type` is the optional activity ref type (`activityRefType` in the entity and the `LiveSession` entity) — without it, gRPC-originated sessions would have `activityRefType = null` in the database while WebSocket-originated sessions may populate it, creating inconsistent data for downstream consumers that read session events.
  - `ActivityEndCmd` — empty message. Maps to `ActivityEndDto`.
  - `ActivityStopCmd` — empty message. No existing DTO (stop is handled inline in gateway).
  - `ActivityPauseCmd` — empty message.
  - `ActivityResumeCmd` — empty message.
  - `PresenceCmd` — `PresenceState state = 1`.

- [x] **Task 3: Define event messages, LiveRequest/LiveResponse wrappers, and service** (depends on Task 2)
  Files: `proto/live.proto`
  Add the section banner `// Server → client events` and define:
  - `SessionStateEvent` — `string live_session_id = 1`, `SessionStatus status = 2`, `optional bool is_paused = 3`. Maps to `SessionStateDto` in `src/realtime/dto/session-state.dto.ts`.
  - `SessionErrorEvent` — `string code = 1`, `string message = 2`, `int64 timestamp = 3`. Maps to `SessionErrorDto` in `src/realtime/dto/session-error.dto.ts`. Note: timestamp is `int64` (Unix millis), not an ISO-8601 string — this matches the roadmap spec and is intentional because error events are high-frequency and don't need human-readable timestamps. This message is top-level so `telemetry.proto` can import it later.

  Add the section banner `// Streaming message wrappers` and define:
  - `LiveRequest` — `oneof command` containing all six Cmd messages: `activity_start`, `activity_end`, `activity_stop`, `activity_pause`, `activity_resume`, `presence`. Field names in snake_case matching the message names without the `Cmd` suffix.
  - `LiveResponse` — `oneof event` containing `SessionStateEvent session_state = 1`, `SessionErrorEvent session_error = 2`.

  Add the section banner `// Service definition` with a comment noting this is a bidirectional stream — the client sends commands and receives state/error events. Auth identity comes from metadata/interceptor, not the message. Define:
  - `service LiveService` with one RPC: `rpc LiveSession(stream LiveRequest) returns (stream LiveResponse)`.
