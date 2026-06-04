# `findList` Rewrite — Cursor Keyset + Sections

**Date:** 2026-06-04
**Source:** conversation context — mobile team request note 40

## Key Findings

- `findList` in `src/breath-sessions/breath-sessions.service.ts:85` uses a single CASE-priority offset query; own sessions are group 0 regardless of star, so starring your own session has no effect on sort today.
- Replace with a cursor-keyset section reader producing three independent result sets: `STARRED` (all starred by this user, own or others), `MINE` (all own), `SHARED` (all others' shared). Duplication across sections is intentional — do not dedup.
- Signature changes from `findList(userId, page, pageSize)` to `findList(userId, cursor, pageSize)`. The `listSessions` gRPC controller at line 70 must be updated in the same commit (reads new types from the proto milestone).
- No migration needed — all required indexes already exist: `IDX_breath_sessions_userId_createdAt`, `IDX_breath_sessions_shared_createdAt`, `IDX_breath_session_settings_userId_starred`.

## Details

### Cursor payload (internal, opaque to clients)

```typescript
interface CursorPayload {
  section: 'STARRED' | 'MINE' | 'SHARED';
  createdAt: string; // ISO-8601, last row of prior page
  id: string;        // UUID, tie-breaker
}
// encode: Buffer.from(JSON.stringify(payload)).toString('base64url')
// decode: JSON.parse(Buffer.from(cursor, 'base64url').toString())
```

Absent cursor = start of STARRED, no keyset bound. Any malformed cursor should throw a gRPC `INVALID_ARGUMENT`.

### Section definitions (per authenticated user)

| Section | SQL condition |
|---------|---------------|
| STARRED | `JOIN breath_session_settings s ON s.sessionId=session.id AND s.userId=:me WHERE s.starred=true` |
| MINE | `WHERE session.userId = :me` |
| SHARED | `WHERE session.userId != :me AND session.shared = true` |

Each section sorted `(session.createdAt DESC, session.id DESC)`. The `id` tie-breaker is mandatory — `createdAt` is not unique.

### Boundary spill algorithm

```
collected = []
currentSection = cursor.section (or STARRED if no cursor)

for section in [STARRED, MINE, SHARED] starting at currentSection:
  remaining = pageSize - collected.length
  if remaining == 0: break
  rows = querySection(section, keyset, remaining)
  tag each row with section
  collected.push(...rows)
  keyset = null  // next section starts unbounded

nextCursor = last collected row's (section, createdAt, id)
if collected.length < pageSize and SHARED exhausted: nextCursor = null
```

### Anonymous caller

Only SHARED exists (no userId). Cursor still applies but spans a single section. Return `{ items: [...], nextCursor }`.

### `is_starred` attachment

Reuse existing `settingsService.findByUserAndSessions(userId, ids)`. In the STARRED section `is_starred` is always true by definition; in MINE/SHARED it reflects actual state. A starred-own row appears in both STARRED (is_starred=true) and MINE (is_starred=true) — the `section` field disambiguates for the client.

### Service return shape

```typescript
interface SessionListResult {
  items: Array<BreathSession & { isStarred?: boolean; section: SessionSection }>;
  nextCursor: string | null;
}
```

### Controller changes (`breath-sessions.grpc.controller.ts:70`)

- Read `request.cursor` (instead of `request.page`)
- Call `findList(userId, request.cursor ?? null, request.pageSize)`
- Map: `result.items.map(i => ({ session: toProtoBreathSessionWithStarredDto(i), section: i.section }))`
- Return `{ items, nextCursor: result.nextCursor ?? undefined }`
- Drop `total`, `page`, `pageSize` from response

### Spec tests (`breath-sessions.service.spec.ts`, lines ~165–347)

Existing tests assert offset/`total` behavior — rewrite the `describe('findList')` block entirely. Cover: first page (no cursor), second page (cursor returned by first), section boundary spill (page spans STARRED+MINE), anonymous caller, empty result, malformed cursor rejection.

### How to verify

`npm test` passes. Run locally, call `ListSessions` with no cursor → starred-own sessions appear in STARRED section at top, all own in MINE, others' shared in SHARED. Same session id present in two sections when starred and owned. Cursor from page 1 fetches a disjoint continuation on page 2.
