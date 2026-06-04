# `breath_sessions.proto` — Cursor + Section Contract

**Date:** 2026-06-04
**Source:** conversation context — mobile team request note 40

## Key Findings

- Current proto uses offset pagination (`page`, `page_size` in request; `total`, `page`, `page_size` in response) with no section concept.
- New contract: `ListSessionsRequest` carries an opaque `cursor` string on field tag 1 (reuse of old `page` tag — safe, lockstep deploy, no prod); `ListSessionsResponse` drops all numeric pagination fields and returns `repeated SessionListItem items` + `optional string next_cursor`.
- A new `SessionSection` enum (STARRED=0, MINE=1, SHARED=2) and `SessionListItem` wrapper are added so the client can render sections even when the same session appears twice (duplication is intentional by design).
- This milestone alone leaves TypeScript compilation errors in the controller (which still references `result.data`, `total`, etc.) — expected and not a blocker; the service+controller milestone resolves them.

## Details

### Target proto diff

```proto
enum SessionSection {
  STARRED = 0;
  MINE = 1;
  SHARED = 2;
}

message SessionListItem {
  BreathSessionWithStarredDto session = 1;
  SessionSection section = 2;
}

message ListSessionsRequest {
  optional string cursor = 1;   // replaces page (tag 1 reuse — lockstep, confirmed safe)
  int32 page_size = 2;
}

message ListSessionsResponse {
  repeated SessionListItem items = 1;
  optional string next_cursor = 2;
  // removed: total, page, page_size
}
```

### Files to change

- `proto/breath_sessions.proto` — edit as above
- Run `npm run proto:gen` to regenerate `proto/generated/` (do not edit generated files by hand)

### Tag reuse rationale

Field 1 in `ListSessionsRequest` was `int32 page`. It becomes `optional string cursor`. Proto3 wire-compat requires the same tag to carry the same wire type — `int32` is varint (wire type 0), `string` is length-delimited (wire type 2). These differ, so any client sending the old `page` field will produce a parse error on the new binary. This is acceptable: all consumers (`mind_mobile`, `mind_mcp`) regenerate from the same proto in lockstep and there is no production deployment to protect.

### How to verify

`npm run proto:gen` completes without error. New TypeScript types `SessionSection`, `SessionListItem`, `ListSessionsRequest` (with `cursor?`), `ListSessionsResponse` (with `items`, `nextCursor`) are present in `proto/generated/breath_sessions.ts`.
