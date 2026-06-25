# Meditation Notes Service — Test Plan

**Date:** 2026-06-25
**Source:** roadmap-test-coverage agent

## Source Overview

The `MeditationNotesService` manages user meditation notes linked to sessions and poses. It provides three operations:
1. **create** — insert a new note, with fallback logic for session-reference violations
2. **updateText** — modify note text with ownership validation
3. **list** — cursor-based pagination over a user's notes

Error handling includes gRPC exceptions for constraint violations (23505 = unique, 23503 = foreign key) and authorization checks.

## Instantiation

### Manual instantiation (for unit-level testing)
```typescript
const repo = createMockRepository();
const service = new MeditationNotesService(repo as any);
```

### NestJS Testing Module (for integration-like tests)
```typescript
const module = await Test.createTestingModule({
  providers: [
    MeditationNotesService,
    {
      provide: getRepositoryToken(MeditationNote),
      useValue: createMockRepository(),
    },
  ],
}).compile();
const service = module.get(MeditationNotesService);
```

### Mock Repository

Must implement:
- `create(object)` — returns partial entity (not saved)
- `save(entity)` — persists and returns entity with generated id
- `findOneBy(where)` — query by id, returns entity or null
- `createQueryBuilder(alias)` — returns chainable query builder

### Mock Query Builder

Must support method chaining:
- `where(sql, params)` → self
- `andWhere(sql, params)` → self
- `orderBy(column, direction)` → self
- `take(limit)` → self
- `getMany()` → Promise<entities[]>

## Existing Coverage

None — this is a new service without a spec file.

## Test Cases

### create() — Basic Success Paths

**should create and save a note with all fields when all inputs are valid**
- Method: `create(userId, sessionId, poseId, noteText)`
- Setup: mock `repo.create()` and `repo.save()` to succeed
- Assert: repo.create called with exact args; repo.save called once; returns saved entity

**should accept null sessionId and save the note**
- Method: `create(userId, null, poseId, noteText)`
- Setup: mock repo to accept null sessionId
- Assert: saved entity has sessionId === null

**should generate a uuid id on successful save**
- Method: `create(...)`
- Setup: mock repo.save to return entity with `id: 'uuid-12345'`
- Assert: returned entity.id exists and is non-empty

**should assign userId, sessionId, poseId, noteText fields as provided**
- Method: `create(userId, sessionId, poseId, noteText)`
- Setup: provide distinct test values for each param
- Assert: returned entity has exact field values

### create() — Constraint Violation Paths

**should throw RpcException with ALREADY_EXISTS when unique constraint fails (code 23505)**
- Method: `create(...)`
- Setup: mock repo.save to throw QueryFailedError with `code: '23505'`
- Assert: throws RpcException with code GrpcStatus.ALREADY_EXISTS; message contains "already exists"

**should throw original error when QueryFailedError has code !== 23505 and !== 23503**
- Method: `create(...)`
- Setup: mock repo.save to throw QueryFailedError with code '28000' (auth error)
- Assert: re-throws the same error (not caught)

**should throw non-QueryFailedError as-is (e.g., network, parse)**
- Method: `create(...)`
- Setup: mock repo.save to throw Error("timeout")
- Assert: error propagates unchanged

### create() — Foreign Key Violation & Retry

**should retry with sessionId=null when foreign key constraint fails (code 23503)**
- Method: `create(userId, sessionId, poseId, noteText)`
- Setup: first repo.save call throws QueryFailedError with code '23503'; second call succeeds
- Assert: repo.save called twice; first call has sessionId from param; second call has sessionId === null; returns second result

**should catch QueryFailedError instance specifically (not other errors with code property)**
- Method: `create(...)`
- Setup: mock repo.save to throw plain Error with code property (not QueryFailedError)
- Assert: error is re-thrown (foreign key fallback does not apply)

### updateText() — Success Paths

**should update noteText and save when note exists and user owns it**
- Method: `updateText(noteId, userId, noteText)`
- Setup: mock repo.findOneBy to return existing note; user ids match
- Assert: note.noteText updated; repo.save called once; returns updated note

**should find note by noteId using findOneBy**
- Method: `updateText(noteId, userId, noteText)`
- Setup: mock findOneBy
- Assert: findOneBy called with `{ id: noteId }`

**should preserve other fields (id, userId, sessionId, poseId, createdAt, updatedAt)**
- Method: `updateText(noteId, userId, noteText)`
- Setup: retrieve note with existing field values; update noteText
- Assert: returned entity has unchanged id, userId, sessionId, poseId

**should allow updating to empty string**
- Method: `updateText(noteId, userId, '')`
- Setup: mock repo to succeed
- Assert: note.noteText === ''; returns successfully

**should allow updating to very long text**
- Method: `updateText(noteId, userId, 'x'.repeat(10000))`
- Setup: mock repo to succeed
- Assert: note.noteText set to full text; saves and returns

### updateText() — Error Paths

**should throw NOT_FOUND when note does not exist**
- Method: `updateText(noteId, userId, noteText)`
- Setup: mock repo.findOneBy to return null
- Assert: throws RpcException with code GrpcStatus.NOT_FOUND; message contains "not found"

**should throw PERMISSION_DENIED when note.userId !== provided userId**
- Method: `updateText(noteId, 'other-user-id', noteText)`
- Setup: mock findOneBy to return note with userId='original-user-id'
- Assert: throws RpcException with code GrpcStatus.PERMISSION_DENIED; message contains "belongs to another user"

**should check permission before saving (fail-fast)**
- Method: `updateText(noteId, 'other-user', noteText)`
- Setup: mock findOneBy and repo.save
- Assert: repo.save is never called

**should throw original error if repo.save fails after permission check**
- Method: `updateText(noteId, userId, noteText)`
- Setup: findOneBy succeeds; save throws QueryFailedError
- Assert: error propagates unchanged

### list() — Pagination Success Paths

**should return all notes ordered DESC by createdAt when no pageToken**
- Method: `list(userId, pageSize, pageToken)`
- Setup: mock query builder to return 3 notes; pageSize=10, pageToken=''
- Assert: returned.notes contains all 3 items in DESC order; nextPageToken === ''

**should enforce default pageSize of 20 when pageSize is 0 or falsy**
- Method: `list(userId, 0, '')`
- Setup: mock query builder to return notes
- Assert: queryBuilder.take called with 21 (20 + 1 for hasMore check)

**should cap pageSize at 100**
- Method: `list(userId, 500, '')`
- Setup: mock query builder
- Assert: queryBuilder.take called with 101 (100 + 1)

**should include limit + 1 in query to detect hasMore**
- Method: `list(userId, 20, '')`
- Setup: mock query builder; provide exact setup to capture take() arg
- Assert: take() called with 21

**should return nextPageToken as base64url of last item's createdAt when more items exist**
- Method: `list(userId, 2, '')`
- Setup: mock query builder to return 3 items with createdAt values
- Assert: nextPageToken === Buffer.from(items[1].createdAt.toISOString()).toString('base64url')

**should return empty nextPageToken when no more items**
- Method: `list(userId, 10, '')`
- Setup: mock query builder to return 5 items
- Assert: returned.nextPageToken === ''

**should only return up to pageSize items, not pageSize + 1**
- Method: `list(userId, 2, '')`
- Setup: mock query builder to return 3 items
- Assert: returned.notes has length 2

### list() — Cursor Pagination Paths

**should apply cursor filter when pageToken is provided**
- Method: `list(userId, 20, pageToken)`
- Setup: mock query builder; provide valid base64url pageToken
- Assert: andWhere called with 'n.createdAt < :cursor' and decoded pageToken value

**should decode pageToken from base64url to UTF-8**
- Method: `list(userId, 20, pageToken)`
- Setup: pageToken = Buffer.from('2026-01-15T10:30:00.000Z').toString('base64url')
- Assert: andWhere called with cursor param matching decoded string

**should use userId in WHERE clause**
- Method: `list(userId, 20, '')`
- Setup: mock query builder
- Assert: where called with 'n.userId = :userId' and { userId }

**should chain where and andWhere correctly for two-clause query**
- Method: `list(userId, 20, pageToken)`
- Setup: mock query builder chaining
- Assert: where() returns qb; andWhere() called on returned qb; all methods chainable

**should handle corrupted pageToken gracefully (base64url decode error)**
- Method: `list(userId, 20, 'invalid!!!base64')`
- Setup: token cannot be decoded
- Assert: throws error (Buffer.from will throw or andWhere gets garbage value — verify actual behavior)

### list() — Response Structure

**should return object with keys "notes" and "nextPageToken"**
- Method: `list(userId, 20, '')`
- Setup: mock query builder
- Assert: returned object has exactly keys { notes, nextPageToken }

**should return notes as array even when empty**
- Method: `list(userId, 20, '')`
- Setup: mock query builder to return []
- Assert: returned.notes === []; nextPageToken === ''

**should preserve note entity structure (id, userId, sessionId, poseId, noteText, createdAt, updatedAt)**
- Method: `list(userId, 20, '')`
- Setup: mock query builder to return notes with full fields
- Assert: returned notes contain all expected fields unchanged

### list() — QueryBuilder Chain Verification

**should call createQueryBuilder with alias 'n'**
- Method: `list(...)`
- Setup: mock repo.createQueryBuilder
- Assert: createQueryBuilder called with 'n'

**should call orderBy with 'n.createdAt' and 'DESC'**
- Method: `list(...)`
- Setup: mock query builder
- Assert: orderBy called with 'n.createdAt', 'DESC'

**should call take with (limit + 1)**
- Method: `list(userId, 30, '')`
- Setup: mock query builder
- Assert: take called with 31

**should call getMany() exactly once**
- Method: `list(...)`
- Setup: mock query builder
- Assert: getMany called once; returns Promise

## Gotchas

1. **Buffer encoding in pageToken** — pagination uses base64url encoding and expects ISO timestamp strings. Test both valid and edge-case strings (empty, short, non-ISO).

2. **QueryFailedError instanceof check** — the code checks `err instanceof QueryFailedError` before accessing `.code`. A plain Error with a `.code` property will not match. Test that fallback to foreign-key retry does not trigger on non-QueryFailedError.

3. **Async/await in create()** — two `repo.save()` calls in sequence on foreign-key retry. If either fails, original error propagates. Verify both calls execute and second result is returned.

4. **Query builder method chaining** — all query builder methods return the builder instance (fluent interface). Mock must return self on each method (where, andWhere, orderBy, take).

5. **Pagination edge case: exactly limit items** — when rows.length === limit, hasMore is false (no +1). Ensure slice logic returns all items and nextPageToken is empty.

6. **Permission check in updateText()** — happens before save. A note found but with different userId must throw PERMISSION_DENIED and never call repo.save().

7. **Constraint error codes** — PostgreSQL-specific error codes (23505 = unique violation, 23503 = foreign key violation). Only these two are handled; all others re-throw.

8. **Null sessionId handling** — service accepts and saves null sessionId normally. Only on FK violation does it force sessionId to null and retry.

9. **ISO string for cursor token** — createdAt is a Date object; cursor is built from `.toISOString()`. Ensure the token round-trips correctly through Buffer encode/decode.

