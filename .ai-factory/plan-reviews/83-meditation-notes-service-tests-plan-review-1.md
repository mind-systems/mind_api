# Plan Review: Meditation Notes Service Tests

**Plan:** `83-meditation-notes-service-tests.md`
**Target:** `src/meditation-notes/meditation-notes.service.spec.ts` (new)
**Risk Level:** 🟢 Low

## Scope

A test-only plan: unit tests for `MeditationNotesService.create / updateText / list` against a mocked `Repository<MeditationNote>`. No production code, no schema, no migration — so the migration/security/architecture gates are largely N/A. The review focuses on correctness of the plan's assumptions against the actual code.

## Context Gates

- **Architecture:** Test-only change inside an existing module. The plan honors the project rule that entity repositories are mocked rather than wired through a Nest `TestingModule`, matching the direct-construction pattern in `sync.service.spec.ts`. No boundary concerns. — OK
- **Rules:** Logging set to minimal, docs disabled — appropriate for a spec-only task. English-only output respected. — OK
- **Roadmap:** Consistent with the surrounding `81-*` / `82-*` service-test milestones (BCI, NFB). No linkage gap worth flagging. — OK

## Verification Against the Codebase

Every assumption in the plan was checked against `meditation-notes.service.ts` and `entities/meditation-note.entity.ts`:

- **`create` happy path / constraint branches** — matches source: `repo.create(...)` → `repo.save(...)`, `QueryFailedError` with `code === '23505'` → `RpcException(ALREADY_EXISTS, 'Note for this session already exists')`; `code === '23503'` → `note.sessionId = null` then a second `repo.save`. ✓
- **Error pass-through (Task 4)** — correct. A non-`QueryFailedError` (plain `Error`) fails the `instanceof` check and is re-thrown even if it carries `code = '23505'`; an unrecognized `QueryFailedError` code falls through to `throw err`. The plan's two distinct cases are accurate. ✓
- **FK-retry call count (Task 3)** — the second `repo.save` is intentionally outside the try/catch, so asserting `save` called exactly twice is correct. The setup note that `repo.create` returns the passed object (so `sessionId = null` is observable on the same instance) is the right mechanism. ✓
- **`updateText` (Tasks 5–7)** — `findOneBy({ id: noteId })`, NOT_FOUND on null, PERMISSION_DENIED with `'Note belongs to another user'` on `userId` mismatch, then assign + `save`. ✓
- **`list` (Tasks 8–10)** — `Math.min(pageSize || 20, 100)`, `where('n.userId = :userId')`, `orderBy('n.createdAt', 'DESC')`, `take(limit + 1)`, base64url cursor decode → `andWhere('n.createdAt < :cursor')`, `hasMore = rows.length > limit`, slice to limit, encode last item's `createdAt.toISOString()` as base64url. All assertions line up with source. ✓
- **gRPC status codes** — `ALREADY_EXISTS`, `NOT_FOUND`, `PERMISSION_DENIED` from `@grpc/grpc-js` `status`, asserted via `err.getError()`. Matches the `RpcException` payload shape used in the service. ✓
- **`createdAt` as a real `Date`** — required for `.toISOString()` in cursor encoding; the setup note calls this out correctly. ✓

## Observations (non-blocking)

- The `updateText` NOT_FOUND message in source is `'Note not found'`. Task 5 only asserts the `code`, not the message — that is fine and consistent, just noting the asymmetry with Tasks 2/6 which do assert messages. If desired, an optional message assertion would round out the coverage, but it is not required.
- The FK-retry's second `save` is unguarded, so a failure there throws raw. The plan does not (and need not) cover that path; the create method has no try/catch around the retry by design.
- Test command and target paths are correct: `src/meditation-notes/` exists, contains the service and no spec yet, and `npx jest src/meditation-notes/meditation-notes.service.spec.ts` is the right invocation.

## Conclusion

The plan is accurate, complete, and faithful to the actual implementation. Method names, signatures, error codes, messages, constraint codes, cursor encoding, and limit handling all match the source. The mocking strategy and direct-construction style are consistent with the established `sync.service.spec.ts` precedent. No missing steps, wrong assumptions, or incorrect paths found.

PLAN_REVIEW_PASS
