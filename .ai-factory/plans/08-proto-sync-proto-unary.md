# Plan: proto/sync.proto (unary)

## Context
Define the `sync.proto` contract for the unary `GetChanges` RPC. The response uses `oneof` to return either a `SyncChangesPayload` (cursor-paginated events) or a `full_resync` flag, matching the existing REST `GET /sync/changes` behavior.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto definition

- [x] **Task 1: Create `proto/sync.proto`**
  Files: `proto/sync.proto`
  Create the file following project conventions (`syntax = "proto3"; package mind;`, section banners, sequential field numbering from 1).

  **Shared types section:**
  - `SyncEventDto` message with fields: `id` (`int64`, field 1), `entity` (`string`, field 2), `ref_id` (`string`, field 3), `action` (`string`, field 4), `created_at` (`string`, field 5 — ISO-8601, same convention as `BreathSessionDto` timestamps in `breath_sessions.proto`).
  - `SyncChangesPayload` message with: `events` (`repeated SyncEventDto`, field 1), `cursor` (`int64`, field 2), `has_more` (`bool`, field 3).
  - Add a comment on `SyncEventDto` mapping it to `SyncEventDto` in `src/sync/dto/sync-changes.dto.ts`.
  - Use `int64` for `id` and `cursor` since they represent auto-increment IDs that may exceed int32 range over time. This also matches the roadmap spec (`after: int64`).

  **Per-RPC request / response section:**
  - `GetChangesRequest` with: `after` (`int64`, field 1), `limit` (`int32`, field 2). Add comment: "Auth identity comes from metadata/interceptor, not the message."
  - `GetChangesResponse` with `oneof result`: `SyncChangesPayload payload = 1`, `bool full_resync = 2`.
  - Note: this is the first use of `oneof` in a unary response (existing `oneof` usage is in streaming envelopes). Name the oneof `result` to describe the branching nature (not `event` or `command` which are stream-specific conventions).

  **Service definition section:**
  - `SyncService` with: `rpc GetChanges(GetChangesRequest) returns (GetChangesResponse);`
  - Leave room for the future `WatchChanges` streaming RPC (next roadmap item) — it will be added to this same service definition later.
