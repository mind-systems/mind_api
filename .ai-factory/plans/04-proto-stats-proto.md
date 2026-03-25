# Plan: proto/stats.proto

## Context
Define the gRPC contract for the stats endpoint (`GetStats`), mirroring the existing REST `GET /users/me/stats` response shape. The proto file becomes the single source of truth for consumers to generate stubs.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto definition

- [x] **Task 1: Create `proto/stats.proto`**
  Files: `proto/stats.proto`
  Create the proto file following the established conventions from `auth.proto` / `users.proto`:
  - Header: `syntax = "proto3"; package mind;`
  - `GetStatsRequest` — empty message (auth identity comes from metadata/interceptor, same pattern as `LogoutRequest` in `auth.proto`).
  - `GetStatsResponse` — maps to `UserStatsResponseDto` in `src/stats/dto/user-stats-response.dto.ts`:
    - `int32 total_sessions = 1`
    - `double total_duration_seconds = 2`
    - `int32 current_streak = 3`
    - `int32 longest_streak = 4`
    - `optional string last_session_date = 5` — `YYYY-MM-DD` or absent; use `optional` for nullable field, same pattern as `last_used_at` in `TokenDto`
    - `double max_completed_complexity = 6`
  - `StatsService` with single RPC: `rpc GetStats(GetStatsRequest) returns (GetStatsResponse);`
  - Add mapping comments linking messages back to their TypeScript source DTOs (same style as other proto files).
  - Timestamps note: `last_session_date` is a date string, not ISO-8601 datetime — add a brief comment clarifying the `YYYY-MM-DD` format.
