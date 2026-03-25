# Review: proto/breath_sessions.proto

**Plan:** `.ai-factory/plans/03-proto-breath-sessions-proto.md`
**Scope:** `proto/breath_sessions.proto` (new file, 190 lines)

## Code Review Summary

**Files Reviewed:** 1 (`proto/breath_sessions.proto`)
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** WARN (informational). Proto files live in `proto/` at project root, outside the `src/` module structure. This is correct for contract files, no violation.
- **RULES.md:** WARN — not applicable. No TypeScript code; no-`!`-operator and logging rules are irrelevant.
- **ROADMAP.md:** OK — milestone `proto/breath_sessions.proto` is marked `[x]`. All RPCs and message types match the roadmap description. Note: the roadmap's simplified notation says `BatchGetSessions → repeated BreathSessionDto` and `GetSession → BreathSessionDto`, but the proto correctly uses `BreathSessionWithStarredDto` for both — matching the actual service behavior (`findBatch` and `findOne` attach `isStarred` when authenticated). The proto is more accurate than the roadmap shorthand.

### Cross-check: Proto fields vs existing DTOs / entities

| Proto type | Source DTO / Entity | Match |
|---|---|---|
| `StepType` (INHALE=0, EXHALE=1, HOLD=2) | `BreathStep.type: 'inhale' \| 'exhale' \| 'hold'` | exact (int-to-string mapping at transport) |
| `TimeOfDay` (MORNING=0, MIDDAY=1, EVENING=2) | `TimeOfDay` enum (MORNING='morning', MIDDAY='midday', EVENING='evening') | exact |
| `StepDto` (type, duration) | `BreathStep` interface (type, duration) | exact |
| `ExerciseDto` (steps, rest_duration, repeat_count) | `BreathExercise` interface (steps, restDuration, repeatCount) | exact (snake_case proto convention) |
| `BreathSessionDto` (10 fields) | `BreathSession` entity (id, userId, description, exercises, complexity, shared, timeOfDay, createdAt, updatedAt, deletedAt) | exact — all fields mapped, timestamps as ISO-8601 strings matching auth.proto convention |
| `BreathSessionWithStarredDto` (session + is_starred?) | TS `BreathSessionWithStarredDto extends BreathSession { isStarred? }` | correct — proto uses composition instead of inheritance (proto has no inheritance), avoids field duplication |
| `CreateSessionRequest` (description, exercises, shared?, time_of_day?) | `CreateBreathSessionDto` (description, exercises, shared?, timeOfDay?) | exact |
| `UpdateSessionRequest` (id, description?, exercises?, shared?, time_of_day?) | `UpdateBreathSessionDto` (description?, exercises?, shared?, timeOfDay?) | exact — `ExerciseList` wrapper correctly enables proto3 presence tracking for repeated field |
| `ReplaceSessionRequest` (id, description, exercises, shared, time_of_day?) | `ReplaceBreathSessionDto` (description, exercises, shared, timeOfDay?) | exact — required/optional semantics match PUT intent |
| `UpdateSessionSettingsRequest` (id, starred) | `UpdateBreathSessionSettingsDto` (starred) | exact |
| `UpdateSessionSettingsResponse` (starred) | `BreathSessionSettingsResponseDto` (starred) | exact |
| `ListSessionsRequest` (page, page_size) | `ListQueryDto` (page=1, pageSize=20) | correct — proto3 cannot express defaults; adapter layer will handle |
| `ListSessionsResponse` (data, total, page, page_size) | `BreathSessionListResponseDto` (data, total, page, pageSize) | exact |
| `GetSuggestionsRequest` (time_of_day) | `SuggestionsQueryDto` (timeOfDay, required) | exact |
| `GetSuggestionsResponse` (repeated BreathSessionDto) | `BreathSession[]` from `findSuggestions()` | correct — no `isStarred`, plain sessions |
| `BatchGetSessionsRequest` (repeated ids, max 50) | `BatchQueryDto` (ids, @ArrayMaxSize(50)) | exact |
| `BatchGetSessionsResponse` (repeated BreathSessionWithStarredDto) | `findBatch()` returns `(BreathSession & { isStarred? })[]` | correct — attaches isStarred when authenticated |

### RPC coverage vs REST endpoints

| REST endpoint | Proto RPC | Status |
|---|---|---|
| `POST /breath-sessions` | `CreateSession` | covered |
| `GET /breath-sessions` | `ListSessions` | covered |
| `GET /breath-sessions/suggestions` | `GetSuggestions` | covered |
| `GET /breath-sessions/batch` | `BatchGetSessions` | covered |
| `GET /breath-sessions/:id` | `GetSession` | covered |
| `PATCH /breath-sessions/:id` | `UpdateSession` | covered |
| `PUT /breath-sessions/:id` | `ReplaceSession` | covered |
| `PATCH /breath-sessions/:id/settings` | `UpdateSessionSettings` | covered |
| `DELETE /breath-sessions/:id` | `DeleteSession` | covered |

Full coverage. No endpoint missed, no extra RPC added.

### Proto syntax verification

- Field numbers: sequential (1-based), no gaps, no collisions across all 21 messages + 2 enums
- `optional` keyword: correctly applied to nullable fields (`time_of_day`, `deleted_at`, `is_starred`) and optional request fields (`shared`, `description`, `exercises` in update) — requires protobuf 3.15+
- `repeated` keyword: correctly applied to list fields (`steps`, `exercises`, `ids`, `data`, `suggestions`, `sessions`)
- `ExerciseList` wrapper: correct proto3 idiom for optional-repeated — gives `has_exercises` presence tracking for PATCH semantics
- Enum zero values without `UNSPECIFIED` sentinel: follows same convention as `UserRole` in `auth.proto` — acceptable here because `StepType` and `TimeOfDay` are always explicitly set in constructing exercises/queries
- No imports needed — all types are self-contained; no cross-file references
- Package `mind` and syntax `proto3` consistent with all other proto files
- No naming collisions with types in `auth.proto`, `users.proto`, `live.proto`, `stats.proto`, `sync.proto`, `device.proto`, or `telemetry.proto`

### Critical Issues

None.

### Suggestions

None.

### Positive Notes

- Thorough source-file mapping comments on every message and enum — excellent for traceability
- `ExerciseList` wrapper is well-documented with clear rationale for why proto3 `optional` can't apply to `repeated` fields
- `BreathSessionWithStarredDto` composition pattern avoids field duplication and silent contract drift — properly documented
- Auth/optional-auth semantics clearly documented both per-RPC and in the service definition block comment
- Return type choices are precise: mutations return plain `BreathSessionDto`, queries that may attach `isStarred` return `BreathSessionWithStarredDto` — exactly matching service method signatures
- Consistent section-separator style and comment conventions matching auth.proto and other proto files
- `BatchGetSessionsRequest.ids` field includes inline max-50 comment matching the `@ArrayMaxSize(50)` validation

REVIEW_PASS
