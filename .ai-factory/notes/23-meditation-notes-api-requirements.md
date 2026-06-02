# Meditation Notes — API Requirements from Mobile Team

**Date:** 2026-06-02
**Source:** product discussion

## Summary

The mobile app is adding a post-session note feature to the meditation module. After pressing Stop, the user sees a text input screen. They can type a note and tap OK (saves) or Cancel (discards). The save happens asynchronously in the background — the user is never blocked waiting for the server.

The key product decision: **the note is the primary entity, not the session**. If a user has a non-empty note for a session, the note must survive even if the session biometric data is deleted. The note is a personal reference the user may care about long-term.

---

## What We Need From You

### 1. New table: `meditation_notes`

Fields:
- `id` — UUID, primary key
- `user_id` — FK to users (required)
- `session_id` — nullable FK to meditation sessions, **no cascade delete** (see deletion policy below)
- `pose_id` — text, denormalized (e.g. `"lotus"`, `"easy"`) — survives even if the session row is gone
- `note_text` — text
- `created_at` — timestamp
- `updated_at` — timestamp

`session_id` must be **nullable** and must **not cascade delete**. When a session is deleted, the note row stays; only `session_id` is set to null (or left as-is if you prefer to keep the orphan reference — we need to agree on this).

### 2. Deletion policy

When a user deletes a session (or when biometric data purge runs):

- **Note is non-empty** → keep the note, detach from the session (set `session_id = null` or simply do not delete the note row). The session biometrics can be purged.
- **Note is empty or does not exist** → delete the session and all its data freely.

This means session deletion must check for an attached note before proceeding.

### 3. gRPC endpoints (proto file: `meditation_notes.proto`)

We need at minimum:

```
service MeditationNotesService {
  // Called after session ends, with the session ID we received from the lifecycle start.
  rpc CreateOrUpdateNote(CreateOrUpdateNoteRequest) returns (MeditationNote);

  // For future history screen — list notes for the authenticated user.
  rpc ListNotes(ListNotesRequest) returns (ListNotesResponse);
}

message CreateOrUpdateNoteRequest {
  string session_id = 1;  // the module session ID from ModuleStateChannel
  string pose_id    = 2;  // e.g. "lotus"
  string note_text  = 3;
}

message MeditationNote {
  string id         = 1;
  string session_id = 2;  // may be empty string if detached
  string pose_id    = 3;
  string note_text  = 4;
  int64  created_at = 5;  // unix ms
  int64  updated_at = 6;
}

message ListNotesRequest {
  int32 page_size  = 1;
  string page_token = 2;
}

message ListNotesResponse {
  repeated MeditationNote notes = 1;
  string next_page_token        = 2;
}
```

Auth: all endpoints are authenticated (same JWT pattern as everything else).

### 4. Proto file location

Per our proto contract rules: author the file in `mind_api/proto/meditation_notes.proto`. Mobile team will copy it to `mind_mobile/proto/` and regenerate Dart stubs after you confirm the contract.

---

## What Mobile Side Does

- After session stops, mobile shows a note screen. If user types text and taps OK, mobile calls `CreateOrUpdateNote` with the `session_id` received from the `ModuleStateChannel` lifecycle handshake and the `pose_id` for the current session.
- Save is fire-and-forget (no loading state, no error surface to the user for now).
- Notes are first saved to a local Drift table (`meditation_notes`) with `serverSessionId` nullable. Local save happens before the gRPC call.
- We will add the gRPC sync in a follow-up task once you confirm the contract.

---

## Open Questions for API Team

1. **Detach vs. keep reference**: when a session is deleted, do you prefer to `SET session_id = NULL` on the note, or simply skip deleting the note row and leave the FK pointing at a now-deleted session? The former is cleaner for queries; the latter avoids a FK-awareness step in deletion logic.

2. **Empty note auto-creation**: should the API auto-create an empty note record when a meditation session starts (so the session is always linked to a note)? Or only create a note when the mobile team explicitly calls `CreateOrUpdateNote`? We lean toward the latter (create only on explicit call) to keep things simple.

3. **History in mobile**: eventually we want to show a history of meditation notes in the mobile app. The `ListNotes` endpoint above is designed for that. Is there anything on your side that blocks pagination or sorting by `created_at` DESC?
