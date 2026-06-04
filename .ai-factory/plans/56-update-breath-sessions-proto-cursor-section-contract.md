# Plan: Update `breath_sessions.proto` — cursor + section contract

## Context
Migrate the `ListSessions` gRPC contract from offset pagination to opaque cursor pagination and introduce explicit session sections (STARRED / MINE / SHARED), then regenerate the TypeScript stubs. TS compilation errors in the controller are expected after this milestone and are resolved by the follow-up service+controller milestone.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Proto contract

- [x] **Task 1: Add `SessionSection` enum and `SessionListItem` message**
  Files: `proto/breath_sessions.proto`
  In the "Shared types" section (after `BreathSessionWithStarredDto`, around line 69), add:
  ```proto
  // Section grouping for ListSessions items. A session may legitimately appear
  // in more than one section (e.g. starred AND mine) — duplication is intentional
  // so the client can render each section independently.
  enum SessionSection {
    STARRED = 0;
    MINE = 1;
    SHARED = 2;
  }

  // Wraps a session with its section so the client can render grouped lists.
  message SessionListItem {
    BreathSessionWithStarredDto session = 1;
    SessionSection section = 2;
  }
  ```

- [x] **Task 2: Rewrite `ListSessionsRequest` and `ListSessionsResponse` for cursor + items** (depends on Task 1)
  Files: `proto/breath_sessions.proto`
  Replace the existing `ListSessionsRequest` (lines 130-133) and `ListSessionsResponse` (lines 136-141) with the cursor/items contract. Reuse field tag 1 in the request for the new cursor field (lockstep deploy, no prod — confirmed safe per spec note 41). Keep the existing leading doc comment on `ListSessionsRequest` (optional auth behaviour) intact.
  ```proto
  // ListSessions — cursor-based pagination.
  // Auth is optional: anonymous users see shared sessions only; authenticated users
  // receive is_starred on each item and the full STARRED/MINE/SHARED grouping.
  message ListSessionsRequest {
    optional string cursor = 1;  // opaque cursor; replaces former `page` (tag 1 reuse — lockstep, confirmed safe)
    int32 page_size = 2;
  }

  message ListSessionsResponse {
    repeated SessionListItem items = 1;
    optional string next_cursor = 2;
    // removed: data, total, page, page_size
  }
  ```
  Do not change the `BreathSessionService` service definition — the `ListSessions` RPC signature (request/response message names) stays the same.

### Phase 2: Codegen

- [x] **Task 3: Regenerate gRPC stubs** (depends on Task 2)
  Files: `proto/generated/breath_sessions.ts` (generated — do not hand-edit)
  Run `npm run proto:gen`. Confirm it completes without error and that `proto/generated/breath_sessions.ts` now contains `SessionSection`, `SessionListItem`, `ListSessionsRequest` with `cursor?`, and `ListSessionsResponse` with `items` + `nextCursor` (numeric pagination fields removed). Do not edit any file under `proto/generated/` by hand.
  Guard: TypeScript compilation errors in `breath-sessions.controller.ts` / service (still referencing `result.data`, `total`, etc.) are expected at this point and are NOT a blocker — the next milestone resolves them.
