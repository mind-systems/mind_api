# Plan: Author `proto/meditation_notes.proto` and regenerate stubs

## Context
Add the missing gRPC contract for meditation notes by authoring `proto/meditation_notes.proto` (package `mind`) and regenerating the TypeScript/NestJS stubs. This is a contract-only milestone — no service, controller, or entity implementation.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto contract

- [x] **Task 1: Author `proto/meditation_notes.proto`**
  Files: `proto/meditation_notes.proto`
  Create a new proto3 file modelled on `proto/nfb_calibration.proto` for structure and `proto/bci_devices.proto` for the ISO-8601 timestamp convention.
  - Header: `syntax = "proto3";` and `package mind;`.
    Note: existing project proto files (`nfb_calibration.proto`, `bci_devices.proto`) do **not** include an `option java_package` line. To match the actual in-repo convention, omit `java_package` even though spec note `24` lists it. Backend (`mind_api`) generation does not consume that option.
  - Add a "Shared types" comment block, then `message MeditationNote`:
    - `string id = 1;`
    - `string session_id = 2;` (empty string if detached — session deleted)
    - `string pose_name = 3;` (opaque client string, no FK, any value accepted)
    - `string note_text = 4;`
    - `string created_at = 5;` (ISO-8601)
    - `string updated_at = 6;` (ISO-8601)
    - Add a comment noting `created_at`/`updated_at` are ISO-8601 strings to match the project convention used in `SyncEventDto` (`proto/sync.proto`), and that `user_id` is intentionally absent (identity comes from the JWT/gRPC interceptor, matching `BciDevice` and `NfbCalibrationRecord`).
  - Add a "Per-RPC request / response messages" comment block, then:
    - `message CreateNoteRequest { string session_id = 1; string pose_name = 2; string note_text = 3; }`
    - `message UpdateNoteRequest { string note_id = 1; string note_text = 2; }` — comment that only `note_text` is mutable; `pose_name` and session binding are immutable after creation.
    - `message ListNotesRequest { int32 page_size = 1; string page_token = 2; }` (`page_token` opaque cursor, empty on first page)
    - `message ListNotesResponse { repeated MeditationNote notes = 1; string next_page_token = 2; }` (`next_page_token` empty when no more pages)
    - Add a comment on the request messages that auth identity comes from the metadata/interceptor, not the message (mirroring the existing proto files).
  - Add a "Service definition" comment block with per-RPC summaries, then:
    ```
    service MeditationNotesService {
      rpc CreateNote(CreateNoteRequest) returns (MeditationNote);
      rpc UpdateNote(UpdateNoteRequest) returns (MeditationNote);
      rpc ListNotes(ListNotesRequest) returns (ListNotesResponse);
    }
    ```

### Phase 2: Stub generation

- [x] **Task 2: Regenerate gRPC stubs** (depends on Task 1)
  Files: `proto/generated/meditation_notes.ts` (generated output)
  Run `npm run proto:gen` from `mind_api/`. Confirm the command completes without errors and that `proto/generated/meditation_notes.ts` is produced and references `MeditationNotesService`, `MeditationNote`, `CreateNoteRequest`, `UpdateNoteRequest`, `ListNotesRequest`, and `ListNotesResponse`. (`proto/generated/` is gitignored; the generated file is a verification artifact, not committed.)
