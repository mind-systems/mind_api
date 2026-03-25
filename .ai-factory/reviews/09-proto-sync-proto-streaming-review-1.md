# Review: proto/sync.proto (streaming)

## Scope
- `proto/sync.proto` — added `WatchChangesRequest`, `ChangeEvent` messages and `WatchChanges` server-streaming RPC
- `.ai-factory/plans/09-proto-sync-proto-streaming.md` — plan file (not reviewed for correctness)

## Validation

- **protoc**: compiles cleanly with no errors
- **Roadmap conformance**: `WatchChanges(after_id?: int64) → stream ChangeEvent(repeated SyncEventDto)` — proto matches the spec exactly
- **Field types**: `optional int64 after_id` correctly gives presence semantics (distinguish "not set" from "set to 0"), `repeated SyncEventDto events` reuses the shared type
- **Field numbering**: sequential from 1 in each new message
- **Section placement**: new messages in "Per-RPC request / response messages", RPC in `SyncService` — consistent with existing structure
- **Comment style**: matches the file's existing conventions (auth-from-metadata note, mapping comments, section banners)

## Observations (non-blocking)

**No `full_resync` signal on the stream.** The unary `GetChanges` returns `oneof { payload | full_resync }` when the cursor is too old. `WatchChanges` has no message-level equivalent — if a client sends an `after_id` that's been purged, the server would need to communicate this out-of-band (e.g., gRPC `FAILED_PRECONDITION` status code closing the stream). This is a valid and arguably cleaner pattern for streaming, but the implementation should document which status code is used and ensure consumers handle it.

## Bugs / Security / Correctness

None found.

REVIEW_PASS
