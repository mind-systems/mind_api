# Plan: Fix `docs/sync/sync.md`

## Context
The sync doc still describes the polling endpoint as REST (`GET /sync/changes`) and push notifications as a Socket.io WebSocket event (`sync:changed`), but both transports were replaced with gRPC — a unary `GetChanges` RPC in `SyncGrpcController` and a server-streaming `WatchChanges` RPC in `SyncStreamGrpcController`. The intro, both transport sections, service references, navigation link, and "See Also" links are all stale. This plan updates the entire doc to match the current implementation.

## Settings
- Testing: no
- Logging: no
- Docs: yes (this milestone is a doc fix)

## Tasks

### Phase 1: Update all transport sections

- [x] **Task 1: Rewrite the polling section from REST to gRPC unary GetChanges**
  Files: `docs/sync/sync.md`
  Replace the entire "## REST — GET /sync/changes" section (lines 22–54) with a new section describing the gRPC unary `GetChanges` RPC. Keep the document in Russian (matching all neighboring docs in `docs/`). The new section must cover:
  - Section heading: rename to reflect gRPC unary (e.g. `## gRPC — unary-запрос GetChanges`).
  - The RPC lives in `SyncGrpcController` (SyncModule) and is defined in `proto/sync.proto` as `rpc GetChanges(GetChangesRequest) returns (GetChangesResponse)`.
  - Auth identity comes from gRPC metadata/interceptor (`GrpcAuthInterceptor`), not from the request message.
  - Request fields (same semantics as the old query params): `after` (`int64`, return events with id > after, pass 0 on first sync) and `limit` (`int32`, max events, 1–100, default 100).
  - Response is a `oneof result`: either a `SyncChangesPayload` containing `events` (list of `SyncEventDto`), `cursor` (`int64`), and `has_more` (`bool`), or a `full_resync` flag (`bool`).
  - Keep the JSON-like response examples but reframe them as protobuf message shapes — the field names and semantics are unchanged.
  - Keep the full resync explanation: returned when `after` is older than the oldest retained event — client must clear local cache and reload.

- [x] **Task 2: Rewrite the push section from WebSocket to gRPC server-streaming WatchChanges**
  Files: `docs/sync/sync.md`
  Replace the entire "## WebSocket — событие sync:changed" section (lines 56–70) with a new section describing the gRPC `WatchChanges` RPC. The new section must cover:
  - Section heading: rename to reflect gRPC streaming (e.g. `## gRPC — серверный стрим WatchChanges`).
  - The RPC lives in `SyncStreamGrpcController` (RealtimeModule) and is defined in `proto/sync.proto` as `rpc WatchChanges(WatchChangesRequest) returns (stream ChangeEvent)`.
  - `WatchChangesRequest` accepts an optional `after_id` field (`int64`). When omitted — streams only new events from the connection moment; when provided — first sends a catchup batch of events with id > after_id, then continues streaming live.
  - If the cursor is too old (older than the oldest retained event), the stream terminates with `FAILED_PRECONDITION` — the client must do a full resync.
  - Events are coalesced with a 300 ms debounce by `SyncStreamService` before being pushed to the stream.
  - Each `ChangeEvent` message wraps a list of `SyncEventDto` items (same shape as the GetChanges response events).
  - Update the client behavior note: the stream itself delivers full event data — no separate RPC call needed after receiving a push (unlike the old pattern of "получив sync:changed, запросить GET /sync/changes").

- [x] **Task 3: Update the introductory paragraph**
  Files: `docs/sync/sync.md`
  Line 5 lists three parts: "журнала изменений в базе данных, REST-эндпоинта для опроса и WebSocket-push для мгновенного уведомления". Both transport mentions are now wrong. Replace the full enumeration with: "журнала изменений в базе данных, gRPC-запроса для опроса и gRPC-стрима для мгновенного уведомления".

### Phase 2: Fix references and remove dead links

- [x] **Task 4: Remove the "Back to README" navigation link**
  Files: `docs/sync/sync.md`
  Delete line 3 (`[Back to README](../../README.md)`) and the blank line after it. This is header navigation clutter prohibited by global documentation rules.

- [x] **Task 5: Update the "Добавление новых сущностей" section**
  Files: `docs/sync/sync.md`
  Line 80 references `SyncNotifierService` — this service no longer exists. Replace the reference with `SyncStreamService` and adjust the sentence: after `CHANGE_EVENT_LOGGED` is emitted, `SyncStreamService` picks it up and pushes to all active gRPC streams for the user.

- [x] **Task 6: Remove the "See Also" section**
  Files: `docs/sync/sync.md`
  Delete the entire "## See Also" block (lines 82–85). Both linked files (`../socket/protocol.md`, `../socket/overview.md`) no longer exist. Do not add replacement links — the realtime docs (`docs/realtime/`) do not currently reference the sync stream, so there is nothing useful to link to.

## Commit Plan
- **Commit 1** (after tasks 1-6): "Update sync doc to reflect gRPC transport replacing REST and WebSocket"
