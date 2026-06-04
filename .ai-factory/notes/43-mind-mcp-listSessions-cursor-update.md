# `mind_mcp` — Update `listSessions` Tool for Cursor Contract

**Date:** 2026-06-04
**Source:** conversation context — mobile team request note 40

## Key Findings

- `mind_mcp/src/tools/listSessions.ts` calls `fetchSessions` with `page`/`pageSize` and returns `{ total, page, pageSize, data: [{id, description, complexity, timeOfDay, shared}] }` to the LLM — all these fields are removed from the new proto contract.
- MCP only fetches the first page (no pagination UI in the tool), so cursor handling is minimal: pass `cursor: undefined` on the first call, ignore `next_cursor` in the response.
- The updated tool must expose `section` from each `SessionListItem` so the LLM can see which section each session belongs to.
- This is a separate git repo — changes go into `mind_mcp/`, not `mind_api/`.

## Details

### Files to change in `mind_mcp/`

1. **`proto/breath_sessions.proto`** — copy from `mind_api/proto/breath_sessions.proto` verbatim (mind_api is the single source of truth).
2. **Regenerate stubs** — run the proto gen script in `mind_mcp` (check `package.json` for the script name, likely `proto:gen` or `gen`).
3. **`src/api/grpc-client.ts`** — update `fetchSessions` (or equivalent) to call with `{ cursor: undefined, pageSize: N }` and return `{ items, nextCursor }` using the new generated types.
4. **`src/tools/listSessions.ts`** — update tool implementation:
   - Use `cursor: undefined` (first page only)
   - Map `response.items` (not `response.data`) to tool output rows
   - Include `section` in each row: `{ id, description, complexity, timeOfDay, shared, section }`
   - Drop `total`, `page`, `pageSize` from tool output
   - Tool description/schema may need updating if it documents the old pagination fields

### Output shape change

```typescript
// Before
{ total: number, page: number, pageSize: number, data: SessionRow[] }

// After
{ items: Array<SessionRow & { section: 'STARRED' | 'MINE' | 'SHARED' }> }
// (nextCursor not surfaced — MCP only needs first page)
```

### How to verify

Run `mind_mcp` locally against a dev API instance. Call the `list_my_breath_sessions` tool — response contains `items[]` with `section` fields, no `total`/`page`/`pageSize`. TypeScript compiles without errors (`npx tsc --noEmit`).
