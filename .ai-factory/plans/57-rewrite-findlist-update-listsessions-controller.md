# Plan: Rewrite `findList` + update `listSessions` controller

## Context
Replace the offset/CASE-priority `findList` with a cursor-keyset section reader that streams STARRED→MINE→SHARED groups via an opaque base64url cursor, and wire the new proto shape (`items` + `nextCursor`, each item carrying its `section`) through the `listSessions` gRPC controller.

## Settings
- Testing: yes (spec block rewrite is part of the milestone)
- Logging: minimal
- Docs: no

## Reference
- Spec note: `.ai-factory/notes/42-findlist-cursor-sections-impl.md` — authoritative for cursor payload, section SQL, boundary-spill algorithm, and verification steps.
- Proto types already generated in `proto/generated/breath_sessions.ts`: `SessionSection` enum (`STARRED=0, MINE=1, SHARED=2`), `SessionListItem { session, section }`, `ListSessionsRequest { cursor?, pageSize }`, `ListSessionsResponse { items, nextCursor? }`. No proto regeneration needed.
- No migration — indexes `IDX_breath_sessions_userId_createdAt`, `IDX_breath_sessions_shared_createdAt`, `IDX_breath_session_settings_userId_starred` already exist (entity `@Index(['userId','createdAt'])`, `@Index(['shared','createdAt'])`).

## Tasks

### Phase 1: Service — cursor codec and section reader

- [x] **Task 1: Add cursor codec, section types, and per-section query helper**
  Files: `src/breath-sessions/breath-sessions.service.ts`
  Add module-level helpers in the service file (above or inside the class):
  - Import `SessionSection` from `../../proto/generated/breath_sessions` and `BadRequestException` from `@nestjs/common`. (`BadRequestException` → HTTP 400 → `GrpcStatus.INVALID_ARGUMENT` via the existing `GrpcExceptionFilter`; do **not** throw `RpcException` from the service.)
  - Define `interface CursorPayload { section: SessionSection; createdAt: string; id: string }`.
  - `encodeCursor(payload: CursorPayload): string` → `Buffer.from(JSON.stringify(payload)).toString('base64url')`.
  - `decodeCursor(raw: string): CursorPayload` → JSON-parse from base64url; validate that `section` is one of `STARRED/MINE/SHARED`, `createdAt` parses to a valid date, and `id` is a non-empty string. On any failure throw `new BadRequestException('Invalid cursor')`.
  - Define the section order array `[SessionSection.STARRED, SessionSection.MINE, SessionSection.SHARED]`.
  - Add a private `querySection(section, userId, keyset: { createdAt: string; id: string } | null, take: number)` returning `BreathSession[]`. Build a `createQueryBuilder('session')` per the section SQL in the note:
    - STARRED: `.innerJoin('breath_session_settings', 'settings', 'settings."sessionId" = session.id AND settings."userId" = :userId AND settings.starred = true', { userId })`
    - MINE: `.where('session."userId" = :userId', { userId })`
    - SHARED: `.where('session."userId" != :userId AND session.shared = true', { userId })` (for anonymous, just `session.shared = true`)
    - When `keyset` is non-null, add `(session."createdAt", session.id) < (:cursorCreatedAt, :cursorId)` as a raw row-value predicate (use `andWhere`).
    - `.orderBy('session.createdAt', 'DESC').addOrderBy('session.id', 'DESC').take(take)`.
  Keep `BreathSession` import and existing repo field; reuse `this.breathSessionRepository`.

- [x] **Task 2: Rewrite `findList(userId, cursor, pageSize)` with boundary-spill loop** (depends on Task 1)
  Files: `src/breath-sessions/breath-sessions.service.ts`
  Replace the entire current `findList` method (lines ~85–140). New signature: `async findList(userId: string | null, cursor: string | null, pageSize: number)`.
  - Decode cursor if present → `CursorPayload`; absent cursor means start at `STARRED` (or `SHARED` for anonymous) with no keyset bound.
  - For anonymous (`userId === null`): the only valid section is `SHARED`. If a cursor is present, accept it only when `section === SHARED` (otherwise treat as invalid → `BadRequestException`). Run a single SHARED query with the keyset, tag rows `section: SHARED`, no `isStarred`.
  - For authenticated callers, run the boundary-spill loop from the note: start at `cursor.section` (or STARRED), iterate the section order; for each section `remaining = pageSize - collected.length`, break when `remaining === 0`, fetch `querySection(section, userId, keyset, remaining)`, tag each row with `section`, push, then set `keyset = null` so subsequent sections start unbounded. Only the starting section uses the decoded keyset.
  - Attach `isStarred`: collect distinct ids of `collected`, call `this.settingsService.findByUserAndSessions(userId, ids)` once. For rows tagged `STARRED`, `isStarred = true` by definition; for `MINE`/`SHARED`, `isStarred = settingsMap.get(id)?.starred ?? false`.
  - Compute `nextCursor`: if `collected.length < pageSize` → `null` (all remaining sections exhausted). Otherwise `encodeCursor({ section, createdAt, id })` from the last collected row (use the row's tagged `section`, ISO string of `createdAt`, and `id`).
  - Return shape: `{ items: collected, nextCursor }` where each item is `BreathSession & { isStarred?: boolean; section: SessionSection }`. Drop the old `{ data, total, page, pageSize }` shape entirely.

### Phase 2: Controller

- [x] **Task 3: Update `listSessions` to read cursor and map sectioned items** (depends on Task 2)
  Files: `src/breath-sessions/breath-sessions.grpc.controller.ts`
  Rewrite the method body (lines ~70–85):
  - Call `this.breathSessionsService.findList(user?.sub ?? null, request.cursor ?? null, request.pageSize)`.
  - Map: `const items = result.items.map((i) => ({ session: toProtoBreathSessionWithStarredDto(i), section: i.section }))`.
  - Return `{ items, nextCursor: result.nextCursor ?? undefined }`.
  - Drop the old `data` / `total` / `page` / `pageSize` response fields.
  - Keep `@GrpcOptionalAuth()`, `@Payload() request`, and `@GrpcCurrentUser()` exactly as-is (project rule: `@Payload()` is mandatory whenever `@GrpcCurrentUser()` is present). `SessionSection` flows through untouched, so no new import is required unless the mapper needs it.

### Phase 3: Tests

- [x] **Task 4: Rewrite the `describe('findList')` spec block** (depends on Task 2)
  Files: `src/breath-sessions/breath-sessions.service.spec.ts`
  Replace the whole `describe('findList')` block (lines ~165–353). Remove all offset/`total`/`group_priority`/`skip`/`take(page)` assertions. Mock `createQueryBuilder` to return a chainable builder whose `getMany()` resolves per-section row sets (the new reader calls `getMany`, not `getManyAndCount`). Cover:
  - First page, no cursor: returns items tagged with their sections, `nextCursor` encodes the last row when a full page is returned.
  - Second page: passing the `nextCursor` from page 1 applies the keyset to the correct starting section and continues disjointly.
  - Section boundary spill: a page that spans STARRED + MINE (starting section yields fewer than `pageSize`, remainder filled from the next section, each row correctly tagged).
  - Anonymous caller (`userId = null`): only SHARED rows, no `isStarred`, cursor still honored.
  - Empty result: `items` empty, `nextCursor === null`.
  - `isStarred`: STARRED-section rows are `true` by definition; MINE/SHARED reflect `settingsService.findByUserAndSessions`.
  - Malformed cursor: rejected with `BadRequestException`.
  Verify with `npm test` (optionally `npx jest src/breath-sessions/breath-sessions.service.spec.ts`).
