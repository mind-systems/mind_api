# Plan: MeditationNotesService (create + updateText + list)

## Context
Implement the business logic of `MeditationNotesService` — note creation (with DB-level duplicate and FK-violation handling), text-only update with ownership check, and cursor-paginated listing. The module skeleton, entity, migration, and proto already exist; only the service body is missing.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Service implementation

- [x] **Task 1: Add imports and gRPC error helpers to the service**
  Files: `src/meditation-notes/meditation-notes.service.ts`
  Extend the existing imports in the skeleton. Add `RpcException` from `@nestjs/microservices` and `import { status as GrpcStatus } from '@grpc/grpc-js'` — matching the exact pattern used in `src/nfb-calibration/nfb-calibration.service.ts` (lines 4–5). Keep the existing `@InjectRepository(MeditationNote)` constructor untouched (`@InjectRepository` must remain confined to this module per ARCHITECTURE.md). Do not add a logger — error throwing is sufficient and keeps logs lean (RULES.md).

- [x] **Task 2: Implement `create(userId, sessionId, poseName, noteText)`** (depends on Task 1)
  Files: `src/meditation-notes/meditation-notes.service.ts`
  Build the row via `this.repo.create({ userId, sessionId, poseName, noteText })` and `await this.repo.save(note)` inside a `try`. In `catch (err)`:
  - On Postgres unique violation `err?.code === '23505'` → `throw new RpcException({ code: GrpcStatus.ALREADY_EXISTS, message: 'Note for this session already exists' })` (the partial unique index `UQ_meditation_notes_session` enforces one note per session at DB level).
  - On FK violation `err?.code === '23503'` (session deleted between session-stop and note-save) → set `note.sessionId = null` and `return this.repo.save(note)` so the note still persists detached.
  - Otherwise re-`throw err`.
  Return type `Promise<MeditationNote>`. Follow the reference implementation in `.ai-factory/notes/27-meditation-notes-service.md` §create. Do NOT use the non-null assertion operator anywhere (RULES.md).

- [x] **Task 3: Implement `updateText(noteId, userId, noteText)`** (depends on Task 1)
  Files: `src/meditation-notes/meditation-notes.service.ts`
  `const note = await this.repo.findOneBy({ id: noteId })`. If falsy → `throw new RpcException({ code: GrpcStatus.NOT_FOUND, message: 'Note not found' })`. If `note.userId !== userId` → `throw new RpcException({ code: GrpcStatus.PERMISSION_DENIED, message: 'Note belongs to another user' })`. Then assign `note.noteText = noteText` only and `return this.repo.save(note)`. `poseName` and `sessionId` are immutable — never touch them. Return type `Promise<MeditationNote>`. Follow `.ai-factory/notes/27-meditation-notes-service.md` §updateText.

- [x] **Task 4: Implement `list(userId, pageSize, pageToken)`** (depends on Task 1)
  Files: `src/meditation-notes/meditation-notes.service.ts`
  Cursor pagination ordered by `createdAt DESC`. Compute `const limit = Math.min(pageSize || 20, 100)` (default 20, hard cap 100). Build a QueryBuilder filtered by `n.userId = :userId`, `orderBy('n.createdAt', 'DESC')`, `take(limit + 1)`. If `pageToken` present, decode it: `Buffer.from(pageToken, 'base64url').toString('utf8')` → an ISO timestamp → `andWhere('n.createdAt < :cursor', { cursor })`. After `getMany()`, set `hasMore = rows.length > limit`, slice to `limit`, and build `nextPageToken` as `Buffer.from(lastItem.createdAt.toISOString()).toString('base64url')` when `hasMore`, else `''`. Return `Promise<{ notes: MeditationNote[]; nextPageToken: string }>`. Follow `.ai-factory/notes/27-meditation-notes-service.md` §list.

- [x] **Task 5: Compile check** (depends on Tasks 2, 3, 4)
  Files: `src/meditation-notes/meditation-notes.service.ts`
  Run `npm run build` to confirm the service compiles with no TypeScript errors and the method signatures match what `MeditationNotesGrpcController` (next milestone) will call: `create(userId, sessionId, poseName, noteText)`, `updateText(noteId, userId, noteText)`, `list(userId, pageSize, pageToken)`.

## Commit Plan
- **Commit 1** (after tasks 1-5): "Implement MeditationNotesService create, updateText and list"
