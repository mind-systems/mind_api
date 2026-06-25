# Test Plan: Meditation Notes Service Tests

## Context
`MeditationNotesService` (`src/meditation-notes/meditation-notes.service.ts`) has no spec file. This plan specifies unit tests for its three methods — `create`, `updateText`, `list` — covering the constraint-violation branches, the ownership guard, and base64url cursor pagination, all against a mocked `Repository<MeditationNote>`.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/meditation-notes/meditation-notes.service.spec.ts`

## Target Spec File
`src/meditation-notes/meditation-notes.service.spec.ts`

## Test Setup Notes (for the implementer)
- Instantiate directly: `new MeditationNotesService(mockRepo as any)` — no Nest TestingModule needed (see `sync.service.spec.ts` for the same direct-construction style).
- Mock `Repository<MeditationNote>` with `jest.fn()` for: `create`, `save`, `findOneBy`, `createQueryBuilder`.
- `repo.create` should return the object passed to it (e.g. `(dto) => ({ ...dto })`) so the `sessionId = null` retry can be asserted on the same instance.
- `createQueryBuilder` must return a chainable stub where `where`, `andWhere`, `orderBy`, `take` all `return this` (return the stub), and `getMany` is a `jest.fn()` resolving to the row array.
- To trigger the constraint branches, reject `repo.save` with a `new QueryFailedError(...)` whose `code` is set to `'23505'` or `'23503'` (cast to attach `code`). Errors that are **not** `instanceof QueryFailedError` (e.g. a plain `Error`) must fall through and be re-thrown unchanged.
- Assert thrown `RpcException`s by inspecting `err.getError()` for the expected `{ code, message }` (gRPC status codes from `@grpc/grpc-js` `status`: `ALREADY_EXISTS`, `NOT_FOUND`, `PERMISSION_DENIED`).
- `createdAt` on a returned row must be a real `Date` so `.toISOString()` works in the `list` cursor encoding.

## Tasks

### Phase 1: create() — persistence and constraint branches

- [x] **Task 1: `MeditationNotesService.create` — happy path**
  Files: `src/meditation-notes/meditation-notes.service.spec.ts`
  Test cases:
  - `should build the entity with the given userId, sessionId, poseId and noteText via repo.create`
  - `should persist via repo.save and return the saved note when save succeeds`
  - `should accept a null sessionId and pass it through to repo.create unchanged`

- [x] **Task 2: `MeditationNotesService.create` — unique constraint (23505)**
  Files: `src/meditation-notes/meditation-notes.service.spec.ts`
  Test cases:
  - `should throw RpcException with code ALREADY_EXISTS when save rejects with QueryFailedError code 23505`
  - `should set the ALREADY_EXISTS message to "Note for this session already exists"`
  - `should not retry save when the unique-constraint branch is taken` (save called exactly once)

- [x] **Task 3: `MeditationNotesService.create` — FK violation (23503)**
  Files: `src/meditation-notes/meditation-notes.service.spec.ts`
  Test cases:
  - `should null out sessionId and retry save when the first save rejects with QueryFailedError code 23503`
  - `should return the note from the second save when the FK-retry succeeds`
  - `should call repo.save twice when the FK-violation branch is taken`

- [x] **Task 4: `MeditationNotesService.create` — error pass-through**
  Files: `src/meditation-notes/meditation-notes.service.spec.ts`
  Test cases:
  - `should re-throw the original error when save rejects with a QueryFailedError whose code is neither 23505 nor 23503`
  - `should re-throw the original error when save rejects with an error that is not a QueryFailedError` (e.g. plain `Error`, even if its code is 23505)
  - `should not retry save when a non-handled error is thrown`

### Phase 2: updateText() — lookup and ownership guard

- [x] **Task 5: `MeditationNotesService.updateText` — not found**
  Files: `src/meditation-notes/meditation-notes.service.spec.ts`
  Test cases:
  - `should look up the note via repo.findOneBy with the given noteId`
  - `should throw RpcException with code NOT_FOUND when findOneBy returns null`
  - `should not call repo.save when the note is not found`

- [x] **Task 6: `MeditationNotesService.updateText` — ownership check**
  Files: `src/meditation-notes/meditation-notes.service.spec.ts`
  Test cases:
  - `should throw RpcException with code PERMISSION_DENIED when the note's userId differs from the requesting userId`
  - `should set the PERMISSION_DENIED message to "Note belongs to another user"`
  - `should not call repo.save when the ownership check fails`

- [x] **Task 7: `MeditationNotesService.updateText` — happy path**
  Files: `src/meditation-notes/meditation-notes.service.spec.ts`
  Test cases:
  - `should assign the new noteText to the note when the requester owns it`
  - `should persist the updated note via repo.save and return the saved result`

### Phase 3: list() — pagination, cursor, and limit handling

- [x] **Task 8: `MeditationNotesService.list` — query construction**
  Files: `src/meditation-notes/meditation-notes.service.spec.ts`
  Test cases:
  - `should filter by userId via where('n.userId = :userId')`
  - `should order by createdAt DESC`
  - `should call take with limit + 1 to detect the presence of a further page`
  - `should default the limit to 20 when pageSize is 0 or falsy`
  - `should cap the limit at 100 when pageSize exceeds 100`

- [x] **Task 9: `MeditationNotesService.list` — cursor decoding**
  Files: `src/meditation-notes/meditation-notes.service.spec.ts`
  Test cases:
  - `should not add an andWhere createdAt clause when pageToken is empty`
  - `should decode the base64url pageToken to an ISO timestamp and apply andWhere('n.createdAt < :cursor') with that value`

- [x] **Task 10: `MeditationNotesService.list` — hasMore and nextPageToken**
  Files: `src/meditation-notes/meditation-notes.service.spec.ts`
  Test cases:
  - `should return all rows and an empty nextPageToken when getMany returns limit or fewer rows`
  - `should drop the extra row (slice to limit) when getMany returns more than limit rows`
  - `should encode the last returned note's createdAt ISO string as a base64url nextPageToken when there are more rows`
  - `should produce a nextPageToken that round-trips back to the last item's createdAt ISO string`
  - `should return an empty notes array and empty nextPageToken when getMany returns no rows`
