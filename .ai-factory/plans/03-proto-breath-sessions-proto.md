# Plan: proto/breath_sessions.proto

## Context
Define the gRPC service contract for the breath sessions domain. This is a contract-only milestone: no code generation, no gRPC transport wiring, no controller changes. The proto file captures all CRUD operations, list/batch queries, suggestions, and per-user settings (starred) — matching the existing REST surface in `src/breath-sessions/`.

## Settings
- Testing: no
- Logging: no
- Docs: no

## Tasks

### Phase 1: Shared types (enums + reusable messages)

- [x] **Task 1: Create proto/breath_sessions.proto with enums and DTO messages**
  Files: `proto/breath_sessions.proto`
  Create the file with header `syntax = "proto3"; package mind;` — same package as `auth.proto` and `users.proto`.

  Define enums (zero value carries real meaning, no `UNSPECIFIED` sentinel — same convention as `UserRole` in `auth.proto`):

  - `enum StepType` — `INHALE = 0; EXHALE = 1; HOLD = 2;` (maps to `'inhale' | 'exhale' | 'hold'` string union in `BreathStep` interface, `src/breath-sessions/entities/breath-session.entity.ts`)
  - `enum TimeOfDay` — `MORNING = 0; MIDDAY = 1; EVENING = 2;` (maps to `TimeOfDay` enum in `src/breath-sessions/enums/time-of-day.enum.ts`)

  Define reusable messages:

  - `message StepDto` — `StepType type = 1; double duration = 2;` (maps to `BreathStep` interface; `duration` is in seconds)
  - `message ExerciseDto` — `repeated StepDto steps = 1; double rest_duration = 2; int32 repeat_count = 3;` (maps to `BreathExercise` interface; an exercise with empty `steps` acts as a rest separator between exercise blocks)
  - `message ExerciseList` — `repeated ExerciseDto exercises = 1;` (wrapper message used by `UpdateSessionRequest` to distinguish "field not sent" from "empty list" for PATCH semantics; proto3 `optional` cannot be applied to `repeated` fields, so wrapping gives presence tracking via `has_exercises`)
  - `message BreathSessionDto` — `string id = 1; string user_id = 2; string description = 3; repeated ExerciseDto exercises = 4; double complexity = 5; bool shared = 6; optional TimeOfDay time_of_day = 7; string created_at = 8; string updated_at = 9; optional string deleted_at = 10;` (maps to `BreathSession` entity; timestamps are ISO-8601 strings — same convention as `TokenDto` in `auth.proto`; `complexity` is computed server-side, read-only in responses)
  - `message BreathSessionWithStarredDto` — uses composition instead of duplicating all fields: `BreathSessionDto session = 1; optional bool is_starred = 2;` (maps to `BreathSessionWithStarredDto` in `src/breath-sessions/dto/breath-session.dto.ts`; `is_starred` is present only when user is authenticated). Composition avoids silent contract drift — if `BreathSessionDto` gains a new field, this message inherits it automatically.

  Add a comment mapping each message/enum to its NestJS source file — same style as `auth.proto` (e.g. `// Maps to BreathSession entity in src/breath-sessions/entities/breath-session.entity.ts`).

### Phase 2: Per-RPC request/response messages

- [x] **Task 2: Add request/response messages for mutation RPCs**
  Files: `proto/breath_sessions.proto`
  Below the shared types section, add a `// Per-RPC request / response messages` separator (same style as `auth.proto`). Define messages for create, update, replace, delete, and settings RPCs:

  - `message CreateSessionRequest` — `string description = 1; repeated ExerciseDto exercises = 2; optional bool shared = 3; optional TimeOfDay time_of_day = 4;` (maps to `CreateBreathSessionDto`; auth identity from metadata)
  - `message UpdateSessionRequest` — `string id = 1; optional string description = 2; optional ExerciseList exercises = 3; optional bool shared = 4; optional TimeOfDay time_of_day = 5;` (maps to `UpdateBreathSessionDto`; PATCH semantics — only provided fields are updated. `exercises` uses the `ExerciseList` wrapper so proto3 presence tracking distinguishes "not sent" (don't change) from "sent with empty list" (clear all exercises))
  - `message ReplaceSessionRequest` — `string id = 1; string description = 2; repeated ExerciseDto exercises = 3; bool shared = 4; optional TimeOfDay time_of_day = 5;` (maps to `ReplaceBreathSessionDto`; PUT semantics — all fields required except `time_of_day` which resets to null when absent)
  - `message UpdateSessionSettingsRequest` — `string id = 1; bool starred = 2;` (maps to `UpdateBreathSessionSettingsDto`)
  - `message UpdateSessionSettingsResponse` — `bool starred = 1;` (maps to `BreathSessionSettingsResponseDto`)
  - `message DeleteSessionRequest` — `string id = 1;`
  - `message DeleteSessionResponse` — `string message = 1;`

- [x] **Task 3: Add request/response messages for query RPCs**
  Files: `proto/breath_sessions.proto`
  Define messages for list, get, batch, and suggestions RPCs:

  - `message ListSessionsRequest` — `int32 page = 1; int32 page_size = 2;` (maps to `ListQueryDto`; auth is optional — anonymous users see shared sessions only, authenticated users get `is_starred` and own/starred/shared grouping)
  - `message ListSessionsResponse` — `repeated BreathSessionWithStarredDto data = 1; int32 total = 2; int32 page = 3; int32 page_size = 4;` (maps to `BreathSessionListResponseDto`)
  - `message GetSessionRequest` — `string id = 1;` (auth optional — authenticated users get `is_starred`)
  - `message GetSuggestionsRequest` — `TimeOfDay time_of_day = 1;` (maps to `SuggestionsQueryDto`; requires auth — uses user's stats for complexity baseline)
  - `message GetSuggestionsResponse` — `repeated BreathSessionDto suggestions = 1;` (returns up to 4 sessions; suggestions endpoint does not attach `is_starred` — service returns plain `BreathSession[]`)
  - `message BatchGetSessionsRequest` — `repeated string ids = 1;` (maps to `BatchQueryDto`; max 50 IDs — add comment noting the limit; auth optional)
  - `message BatchGetSessionsResponse` — `repeated BreathSessionWithStarredDto sessions = 1;` (uses `BreathSessionWithStarredDto` because `findBatch` attaches `isStarred` when authenticated, matching the `findOne`/`findList` behavior)

### Phase 3: Service definition

- [x] **Task 4: Add BreathSessionService definition**
  Files: `proto/breath_sessions.proto`
  Add the service block with a `// Service definition` separator. All RPCs are unary:

  ```protobuf
  service BreathSessionService {
    rpc CreateSession(CreateSessionRequest) returns (BreathSessionDto);
    rpc ListSessions(ListSessionsRequest) returns (ListSessionsResponse);
    rpc GetSuggestions(GetSuggestionsRequest) returns (GetSuggestionsResponse);
    rpc BatchGetSessions(BatchGetSessionsRequest) returns (BatchGetSessionsResponse);
    rpc GetSession(GetSessionRequest) returns (BreathSessionWithStarredDto);
    rpc UpdateSession(UpdateSessionRequest) returns (BreathSessionDto);
    rpc ReplaceSession(ReplaceSessionRequest) returns (BreathSessionDto);
    rpc UpdateSessionSettings(UpdateSessionSettingsRequest) returns (UpdateSessionSettingsResponse);
    rpc DeleteSession(DeleteSessionRequest) returns (DeleteSessionResponse);
  }
  ```

  Return type rationale:
  - `GetSession` → `BreathSessionWithStarredDto` because `findOne(id, userId?)` returns `BreathSession & { isStarred?: boolean }` when authenticated (line 163 of service)
  - `BatchGetSessions` → `BatchGetSessionsResponse` which contains `repeated BreathSessionWithStarredDto` because `findBatch(ids, userId)` attaches `isStarred` when authenticated (line 137-158 of service)
  - `ListSessions` → `ListSessionsResponse` which already uses `BreathSessionWithStarredDto` in its `data` field
  - `CreateSession`, `UpdateSession`, `ReplaceSession` → `BreathSessionDto` because mutations return plain `BreathSession` without `isStarred`
  - `GetSuggestions` → `GetSuggestionsResponse` with plain `BreathSessionDto` because `findSuggestions` returns `BreathSession[]` without star data

  Add a comment noting that `ListSessions`, `GetSession`, and `BatchGetSessions` support optional auth — when auth metadata is present, responses include `is_starred` and `ListSessions` returns the full own/starred/shared grouping; without auth, only shared sessions are returned.

  Cross-check every field name and optionality against the existing DTOs:
  - `CreateBreathSessionDto` → `description` (required), `exercises` (required), `shared` (optional), `timeOfDay` (optional) ✓
  - `UpdateBreathSessionDto` → all four fields optional; `exercises` uses `ExerciseList` wrapper for presence ✓
  - `ReplaceBreathSessionDto` → `description`, `exercises`, `shared` (required), `timeOfDay` (optional, null-resettable) ✓
  - `ListQueryDto` → `page`, `pageSize` (both have defaults but are required in proto) ✓
  - `BreathSessionListResponseDto` → `data` (as `BreathSessionWithStarredDto`), `total`, `page`, `pageSize` ✓
  - `SuggestionsQueryDto` → `timeOfDay` (required) ✓
  - `BatchQueryDto` → `ids` (repeated, 1..50) ✓
  - `BatchGetSessionsResponse` → `sessions` as `BreathSessionWithStarredDto` (matches `findBatch` return type) ✓
  - `UpdateBreathSessionSettingsDto` → `starred` (required) ✓
  - `BreathSessionSettingsResponseDto` → `starred` ✓
  - `BreathSession` entity → all 10 fields mapped to `BreathSessionDto` ✓
  - `BreathSessionWithStarredDto` → composition: `BreathSessionDto session` + `optional bool is_starred` ✓
