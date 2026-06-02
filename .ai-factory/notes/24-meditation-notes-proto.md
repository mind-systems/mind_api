# Meditation Notes Proto Contract

**Date:** 2026-06-02
**Source:** conversation context

## Key Findings

- New `proto/meditation_notes.proto` with `MeditationNotesService`: `CreateNote`, `UpdateNote` (text only), `ListNotes`.
- `CreateOrUpdateNote` split into two RPCs: create takes `session_id`+`pose_name`+`note_text`; update takes `note_id`+`note_text` only.
- Timestamps as ISO-8601 strings — matches project convention (`BciDevice`, `NfbCalibrationRecord`, `SyncEventDto`).
- `user_id` removed from `MeditationNote` response — client already knows its own ID (matches pattern of other resources).
- `pose_id` renamed to `pose_name` — it is an opaque client-side string, not a FK to any table.

## Details

### File header

```proto
syntax = "proto3";
package mind;
option java_package = "com.mind.meditation_notes";
```

### Messages

```protobuf
message MeditationNote {
  string id         = 1;
  string session_id = 2;  // empty string if detached (session was deleted)
  string pose_name  = 3;  // opaque client string, e.g. "lotus" — no FK, any value accepted
  string note_text  = 4;
  string created_at = 5;  // ISO-8601, e.g. "2026-06-02T10:00:00.000Z"
  string updated_at = 6;  // ISO-8601
}

message CreateNoteRequest {
  string session_id = 1;  // module session UUID from ModuleStateChannel handshake
  string pose_name  = 2;
  string note_text  = 3;
}

// Only note_text is updatable; pose_name and session binding are immutable after creation.
message UpdateNoteRequest {
  string note_id   = 1;
  string note_text = 2;
}

message ListNotesRequest {
  int32  page_size  = 1;
  string page_token = 2;  // opaque cursor, empty on first page
}

message ListNotesResponse {
  repeated MeditationNote notes = 1;
  string next_page_token        = 2;  // empty string if no more pages
}
```

### Service

```protobuf
service MeditationNotesService {
  rpc CreateNote(CreateNoteRequest) returns (MeditationNote);
  rpc UpdateNote(UpdateNoteRequest) returns (MeditationNote);
  rpc ListNotes(ListNotesRequest) returns (ListNotesResponse);
}
```

### Design decisions

- **Timestamps ISO-8601**: all other resources in this project use ISO strings for timestamps; `int64` unix ms was a deviation and is corrected here.
- **`user_id` absent from response**: `BciDevice` and `NfbCalibrationRecord` do not expose `user_id`; client identity is implicit from the JWT.
- **`pose_name` is opaque**: client stores pose data locally and sends the name as a string label. Server accepts any value without validation. No FK, no enum constraint.
- **Split RPCs**: `CreateNote` is called once after session ends (fire-and-forget). `UpdateNote` is a future path for editing note text; it takes the note's own UUID so updates are unambiguous even when `session_id` becomes null.

### Auth

Identity from JWT interceptor (`GrpcAuthInterceptor`) — not in request messages.

### Modelled on

`proto/nfb_calibration.proto` for file structure. Timestamp convention from `proto/bci_devices.proto`.

## How to verify

`npm run proto:gen` completes without errors. `proto/generated/` contains a generated file referencing `MeditationNotesService`, `CreateNoteRequest`, `UpdateNoteRequest`, `ListNotesRequest`, `ListNotesResponse`, and `MeditationNote`.
