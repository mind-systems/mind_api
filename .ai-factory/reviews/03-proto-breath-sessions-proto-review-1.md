# Code Review: proto/breath_sessions.proto

**Plan:** `.ai-factory/plans/03-proto-breath-sessions-proto.md`
**Risk Level:** 🟢 Low — proto compiles, all three critical issues from previous review are resolved.

## Compilation

`protoc --proto_path=proto breath_sessions.proto` — compiles with zero errors on protoc 34.0.

## Previous Review Issues — Resolution Check

| # | Issue | Status |
|---|---|---|
| 1 | `optional repeated` invalid syntax | **Fixed** — `ExerciseList` wrapper message (line 42-44), used as `optional ExerciseList exercises = 3` in `UpdateSessionRequest` (line 91) |
| 2 | `GetSession` returns wrong type | **Fixed** — now returns `BreathSessionWithStarredDto` (line 185), matching `findOne(id, userId?)` return type |
| 3 | `BatchGetSessionsResponse` uses wrong DTO | **Fixed** — now `repeated BreathSessionWithStarredDto sessions = 1` (line 168), matching `findBatch` behavior |
| 4 | Composition for `BreathSessionWithStarredDto` | **Adopted** — `BreathSessionDto session = 1; optional bool is_starred = 2;` (lines 67-68) |
| 5 | `suggestions` field name | **Kept as-is** — semantically clearer, acceptable |

## Field-by-Field Verification

Cross-checked every proto message against its TypeScript source:

- **StepType enum** ↔ `BreathStep.type` string union (`'inhale' | 'exhale' | 'hold'`) — correct mapping, conversion handled at gRPC layer ✓
- **TimeOfDay enum** ↔ `TimeOfDay` TS enum (`'morning' | 'midday' | 'evening'`) — correct ✓
- **StepDto** ↔ `BreathStep` interface — `type` + `duration` ✓
- **ExerciseDto** ↔ `BreathExercise` interface — `steps`, `rest_duration` (→ `restDuration`), `repeat_count` (→ `repeatCount`) ✓
- **BreathSessionDto** ↔ `BreathSession` entity — all 10 fields mapped correctly, snake_case ↔ camelCase ✓
- **CreateSessionRequest** ↔ `CreateBreathSessionDto` — `description` (required), `exercises` (required), `shared` (optional), `time_of_day` (optional) ✓
- **UpdateSessionRequest** ↔ `UpdateBreathSessionDto` — all 4 fields optional, `exercises` wrapped in `ExerciseList` for presence ✓
- **ReplaceSessionRequest** ↔ `ReplaceBreathSessionDto` — `description`, `exercises`, `shared` (required), `time_of_day` (optional, null-resettable) ✓
- **UpdateSessionSettingsRequest** ↔ `UpdateBreathSessionSettingsDto` — `id` + `starred` ✓
- **UpdateSessionSettingsResponse** ↔ `BreathSessionSettingsResponseDto` — `starred` ✓
- **ListSessionsRequest** ↔ `ListQueryDto` — `page`, `page_size` ✓
- **ListSessionsResponse** ↔ `BreathSessionListResponseDto` — `data` (as `BreathSessionWithStarredDto`), `total`, `page`, `page_size` ✓
- **GetSuggestionsRequest** ↔ `SuggestionsQueryDto` — `time_of_day` (required) ✓
- **GetSuggestionsResponse** — `repeated BreathSessionDto` matches `findSuggestions` return `BreathSession[]` ✓
- **BatchGetSessionsRequest** ↔ `BatchQueryDto` — `ids` (repeated string) ✓
- **BatchGetSessionsResponse** — `repeated BreathSessionWithStarredDto` matches `findBatch` return `(BreathSession & { isStarred?: boolean })[]` ✓

## Service RPC Verification

All 9 REST endpoints mapped to RPCs with correct request/response types:

| RPC | REST Endpoint | Guard | Return Type | Correct |
|-----|--------------|-------|-------------|---------|
| `CreateSession` | `POST /` | JwtAuthGuard | `BreathSessionDto` | ✓ |
| `ListSessions` | `GET /list` | OptionalJwtAuthGuard | `ListSessionsResponse` | ✓ |
| `GetSuggestions` | `GET /suggestions` | JwtAuthGuard | `GetSuggestionsResponse` | ✓ |
| `BatchGetSessions` | `GET /batch` | OptionalJwtAuthGuard | `BatchGetSessionsResponse` | ✓ |
| `GetSession` | `GET /:id` | OptionalJwtAuthGuard | `BreathSessionWithStarredDto` | ✓ |
| `UpdateSession` | `PATCH /:id` | JwtAuthGuard | `BreathSessionDto` | ✓ |
| `ReplaceSession` | `PUT /:id` | JwtAuthGuard | `BreathSessionDto` | ✓ |
| `UpdateSessionSettings` | `PATCH /:id/settings` | JwtAuthGuard | `UpdateSessionSettingsResponse` | ✓ |
| `DeleteSession` | `DELETE /:id` | JwtAuthGuard | `DeleteSessionResponse` | ✓ |

## Suggestions (non-blocking)

### 1. `ListSessionsRequest.page` / `page_size` default to 0 without `optional`

In proto3, `int32` without `optional` defaults to `0`. The REST API uses defaults (`page=1`, `pageSize=20` via class-validator). A gRPC client that omits these fields sends `0` on the wire, indistinguishable from an explicit `0`.

The gRPC controller implementation will need to treat `0` as "use default" (same way the REST defaults work), e.g. `page = req.page || 1`. This is standard proto3 practice and works fine — just a note for the implementation phase.

Alternative: mark them `optional int32` for explicit presence detection. Not required.

### 2. `GetSuggestionsRequest.time_of_day` cannot distinguish "not set" from `MORNING`

Proto3 enum default is `0` (MORNING). A client that omits `time_of_day` implicitly sends MORNING. Since the REST API requires this field (`@IsNotEmpty()`), the gRPC implementation should similarly validate. This is a known proto3 limitation deliberately accepted by the plan's "no UNSPECIFIED sentinel" convention, matching `auth.proto`.

## Consistency with Existing Protos

- Package `mind` ✓
- Separator comments match `auth.proto` style ✓
- Source-file mapping comments present ✓
- Timestamp convention (ISO-8601 strings) matches `TokenDto` in `auth.proto` ✓
- Auth-from-metadata pattern (no user ID in request messages) matches `LogoutRequest` ✓
- Self-contained file, no imports needed (unlike `users.proto` which imports `auth.proto` for `UserDto`) ✓

REVIEW_PASS
