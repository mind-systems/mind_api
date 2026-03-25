# Plan: proto/sync.proto (streaming)

## Context
Add the `WatchChanges` server-side streaming RPC to the existing `proto/sync.proto`. The client sends a single request with an optional cursor and receives a continuous stream of batched change events. This completes the sync proto contract — unary polling (`GetChanges`) plus realtime streaming (`WatchChanges`).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Streaming messages and RPC

- [x] **Task 1: Add `WatchChangesRequest` and `ChangeEvent` messages**
  Files: `proto/sync.proto`
  Add two new messages in the "Per-RPC request / response messages" section, after the existing `GetChangesResponse` message.

  - `WatchChangesRequest` — single field: `optional int64 after_id = 1;`. Use `optional` to express the `?` from the roadmap spec: when omitted, the server streams only new events from the connection moment; when provided, the server first sends a catchup batch of all events with `id > after_id`, then continues streaming new events in realtime. Add a comment noting auth identity comes from metadata/interceptor (same convention as `GetChangesRequest`).

  - `ChangeEvent` — single field: `repeated SyncEventDto events = 1;`. This is the stream envelope — it carries one or more events per message, allowing the server to batch rapid changes (matching the 300ms coalescing pattern in `SyncNotifierService`). Reuses the existing `SyncEventDto` message already defined in the shared types section. Add a comment noting this is the server-streamed response envelope.

- [x] **Task 2: Add `WatchChanges` RPC to `SyncService`** (depends on Task 1)
  Files: `proto/sync.proto`
  Add the streaming RPC to the existing `SyncService` definition:
  ```
  rpc WatchChanges(WatchChangesRequest) returns (stream ChangeEvent);
  ```
  This is a server-side streaming RPC (unary request, streamed response) — not bidirectional, unlike `LiveSession` and `StreamTelemetry`.

  Remove the comment that says `WatchChanges` is "reserved for the future streaming RPC" from the service definition section banner — it's no longer future, it's defined. Update the section banner to describe both RPCs: `GetChanges` (unary, cursor-paginated) and `WatchChanges` (server-streaming, realtime push).
