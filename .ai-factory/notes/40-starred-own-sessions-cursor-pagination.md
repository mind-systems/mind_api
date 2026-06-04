# Starring Own Breath Sessions + Cursor Pagination with Sections

**Date:** 2026-06-04
**Source:** conversation context

## Key Findings

- The feature requires two coupled changes to `ListSessions`: (1) let a user's **own** sessions be starred and floated into a dedicated top section, and (2) replace offset pagination with an **opaque cursor** (keyset/seek).
- Starring infrastructure already fully exists (table `breath_session_settings`, `UpdateSessionSettings` RPC, `is_starred` on list/get/batch). `UpdateSessionSettings` has **no owner guard**, so a user can already persist a star on their own session today — but the list **sort ignores it** (own sessions are hardcoded to priority group `0`).
- New list shape = **3 sections in fixed order**: `STARRED` (all starred, own + others) → `MINE` (all own) → `SHARED` (all others' shared). **Duplication across sections is intentional and accepted** — no dedup, no tracking of "already shown". A starred-own session appears in both `STARRED` and `MINE`; a starred-others session appears in both `STARRED` and `SHARED`.
- Because of duplication, **every returned item must carry a `section` tag** — otherwise an identical session row (same id, `is_starred=true`) arrives twice and the client cannot tell which section to render it in.
- This is a **proto contract change** owned by `mind_api/proto/`. It must then be copied to and regenerated in **both** consumers: `mind_mobile` (gRPC) and `mind_mcp` (`src/tools/listSessions.ts`).

## Details

### Decisions locked in this conversation

1. **Section order:** `STARRED` first, then `MINE`, then `SHARED`. Within each section, sort by **`session.created_at DESC`** (NOT by when-starred). `id DESC` is the stable tie-breaker since `created_at` is not unique.
2. **Duplication:** allowed and expected. Do not dedup. Do not track what was already returned. Each section is an independent result set over the same table.
3. **Pagination:** single **opaque** cursor, sequential across the three sections (one logical stream `[STARRED…] ++ [MINE…] ++ [SHARED…]`). Server packs the cursor; client returns it verbatim. Replace offset entirely.
4. **`total` is dropped** from the response (no UI needs a count; MCP simply stops surfacing it).
5. **One cursor, not three** (sections are not scrolled independently — it's a single list).
6. **MCP** only needs the first page (cursor optional); update its tool to stop returning `total/page/pageSize`.

### Current state (what exists today)

- **Service:** `src/breath-sessions/breath-sessions.service.ts:85` — `findList(userId: string | null, page: number, pageSize: number)`.
  - Offset pagination: `skip = (page - 1) * pageSize`.
  - Anonymous branch: `where: { shared: true }`, `order: { createdAt: 'DESC' }`.
  - Authenticated branch: one query builder with `LEFT JOIN breath_session_settings` on `(sessionId, userId)`, `WHERE (own OR (starred AND not own) OR (shared AND not own))`, and a `CASE` computing `group_priority`:
    ```
    own → 0,  others+starred → 1,  others+shared → 2
    ```
    ordered by `group_priority ASC, session.createdAt DESC`. **Note:** own sessions are `0` regardless of star, so starring an own session has zero effect on order today.
  - Returns `{ data, total, page, pageSize }`; each item gets `isStarred` from a settings map.
- **gRPC controller:** `src/breath-sessions/breath-sessions.grpc.controller.ts:70` — `listSessions`, decorated `@GrpcOptionalAuth()`. Maps `result.data` via `toProtoBreathSessionWithStarredDto`, passes through `total/page/pageSize`.
- **Transport:** gRPC only. There is **no REST controller** for breath sessions.
- **Proto:** `mind_api/proto/breath_sessions.proto`.
  - `ListSessionsRequest { int32 page = 1; int32 page_size = 2; }`
  - `ListSessionsResponse { repeated BreathSessionWithStarredDto data = 1; int32 total = 2; int32 page = 3; int32 page_size = 4; }`
  - `BreathSessionWithStarredDto { BreathSessionDto session = 1; optional bool is_starred = 2; }` (composition over `BreathSessionDto`).
- **Starring (already done):** entity `breath_session_settings` (`src/breath-sessions/entities/breath-session-settings.entity.ts`) with `starred` boolean, `@Unique(['userId','sessionId'])`, `@Index(['userId','starred'])`. RPC `UpdateSessionSettings(id, starred) → { starred }` (`breath-sessions.grpc.controller.ts`, handler calls `settings.upsert(user.sub, id, { starred })` after `findOne(id)` — no owner check, so own sessions are starrable).
- **Migration baseline:** `src/migrations/1774863293946-InitialSchema.ts` already contains both `breath_sessions` and `breath_session_settings` with all needed indexes. **No new migration is required** for this feature — starring storage and indexes already exist. (Indexes that cover the new queries: `IDX_breath_sessions_userId_createdAt`, `IDX_breath_sessions_shared_createdAt`, `IDX_breath_session_settings_userId_starred`.)
- **Consumers of `ListSessions`:**
  - `mind_mobile` — gRPC, offset pagination, splits into sections client-side.
  - `mind_mcp` — `src/tools/listSessions.ts`, tool `list_my_breath_sessions`, takes `page`/`pageSize`, returns `{ total, page, pageSize, data:[{id,description,complexity,timeOfDay,shared}] }` to the LLM.

### Target proto contract

```proto
enum SessionSection {
  STARRED = 0;
  MINE = 1;
  SHARED = 2;
}

// cursor is opaque: server-packed, client returns it verbatim.
// Absent cursor = first page.
message ListSessionsRequest {
  optional string cursor = 1;   // replaces page
  int32 page_size = 2;          // limit per request
}

// Each item carries its section because duplication is allowed:
// the same session id can appear under STARRED and again under MINE/SHARED.
message SessionListItem {
  BreathSessionWithStarredDto session = 1;
  SessionSection section = 2;
}

message ListSessionsResponse {
  repeated SessionListItem items = 1;
  optional string next_cursor = 2;   // absent/empty => no more pages
}
```

Removed from the response: `total`, `page`, `page_size`.
`ListSessionsRequest.page` (field 1, old) is replaced by `cursor`. Reusing tag `1` is acceptable here because all consumers regenerate from the same proto in lockstep (single org, copied proto snapshots) — but the planner should decide whether to keep `1` or bump to a fresh tag for safety.

### Cursor design (opaque keyset)

- **Logical stream:** `[STARRED…] ++ [MINE…] ++ [SHARED…]`. Each section ordered `(created_at DESC, id DESC)`.
- **Cursor payload (internal, never exposed):** `{ section: STARRED|MINE|SHARED, created_at, id }` = keyset position of the **last returned row**. Encode as base64 of a compact JSON/struct. Treat as opaque end-to-end; client never parses it.
- **First request:** no cursor → start at `STARRED`, no keyset bound.
- **Within a section:** keyset predicate `(created_at, id) < (cursor.created_at, cursor.id)` with `ORDER BY created_at DESC, id DESC LIMIT page_size`.
- **Section definitions (each an independent query for the authenticated user):**
  - `STARRED`: sessions where a `breath_session_settings` row exists with `starred = true` for this user (own **or** others). Join `breath_session_settings`.
  - `MINE`: `session.userId = me` (all of them, starred or not).
  - `SHARED`: `session.userId != me AND session.shared = true` (all of them, starred or not).
- **Boundary spill:** a single page may cross a section boundary. Fill from the current section by keyset; if it yields fewer than `page_size`, advance to the next section (from its start) and continue filling until `page_size` is reached or all sections exhausted. So `page_size` is honored across boundaries, and the returned `next_cursor` points at whichever section filling stopped in.
- **End condition:** when the `SHARED` section is exhausted and the page isn't full, return `next_cursor` absent/empty.
- **Anonymous caller:** only `SHARED` exists (shared sessions). Cursor still applies but spans a single section. `STARRED`/`MINE` are empty for anonymous.

### Server implementation outline (`findList`)

Replace the single `CASE`-priority query with a cursor-driven, section-aware reader:

1. Decode cursor (or start fresh at `STARRED`).
2. Loop sections starting at the cursor's section, in order `STARRED → MINE → SHARED`:
   - Run the section's keyset query with `LIMIT (page_size - collected.length)`.
   - Tag each row with the current `section`.
   - First iteration uses the cursor's `(created_at, id)` bound; subsequent sections start unbounded.
   - Stop when `collected.length == page_size` or sections are exhausted.
3. Attach `is_starred` per row (reuse `settingsService.findByUserAndSessions`). In the `STARRED` section `is_starred` is always true; in `MINE`/`SHARED` it reflects actual state (a starred-own row in `MINE` will also show `is_starred=true` — that's fine, the section tag disambiguates).
4. Build `next_cursor` from the last collected row's `(section, created_at, id)`; if fewer than `page_size` were collected and `SHARED` is exhausted, leave it empty.
5. Return `{ items: [{session, section}], nextCursor }`.

Signature changes to `findList(userId, page, pageSize)` → `findList(userId, cursor, pageSize)`. Update `breath-sessions.service.spec.ts` (`describe('findList')`, lines ~165–347) accordingly — existing tests assert offset/`total` behavior and will need rewriting for cursor + sections.

### gRPC controller change

`listSessions` (`breath-sessions.grpc.controller.ts:70`): read `request.cursor` instead of `request.page`, map service result to `{ items: result.items.map(i => ({ session: toProtoBreathSessionWithStarredDto(i.session), section: i.section })), nextCursor: result.nextCursor }`. Keep `@GrpcOptionalAuth()`.

### Cross-repo rollout (order matters)

1. **`mind_api/proto/breath_sessions.proto`** — apply the contract above (single source of truth).
2. **`mind_api`** — regenerate stubs, implement service + controller + DTO/mapper (`SessionListItem`, `SessionSection`), update specs. No migration needed.
3. **`mind_mobile`** — copy proto into `mind_mobile/proto/`, run `scripts/gen_proto.sh`, then rewrite the list client + pagination (drop offset, store/return opaque `next_cursor`), and render sections from the per-item `section` tag (allowing duplicates). Also expose the star toggle on **own** session cards (currently likely only on others' cards).
4. **`mind_mcp`** — copy proto into `mind_mcp/proto/`, regenerate `src/generated/breath_sessions.ts`, update `src/api/grpc-client.ts` `fetchSessions` and `src/tools/listSessions.ts` to use `cursor` (fetch first page only) and stop returning `total/page/pageSize`.

### Edge cases / gotchas

- **`created_at` is not unique** → `id` tie-breaker is mandatory in both the `ORDER BY` and the keyset comparison, otherwise rows can be skipped or repeated at page boundaries.
- **Mid-scroll mutations** (create/delete/star toggle between pages) are tolerated by keyset far better than offset, but are not snapshot-isolated: e.g. starring a session mid-scroll can make it appear in `STARRED` on a later page. Acceptable; no snapshot needed.
- **Duplicates are by design** — do not add dedup logic anywhere (service, controller, or client).
- **`UpdateSessionSettings` already accepts own sessions** — no backend change needed to *store* a star on an own session; only the *sort/section* logic and mobile UI need work.

## Open Questions

- Proto tag reuse: keep `cursor` on field `1` (was `page`) or assign a fresh tag? Lockstep regeneration makes reuse safe, but the planner should confirm.
- Confirm no other `mind_api` caller (REST/web) depends on `findList`'s old `{ total, page, pageSize }` shape — grep showed only gRPC + specs, but verify during planning.
