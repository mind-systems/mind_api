# Plan Review: MeditationNotesService (create + updateText + list)

**Plan:** `45-meditationnotesservice-create-updatetext-list.md`
**Files Reviewed:** 7 (plan, service skeleton, entity, migration, proto, grpc controller, module, reference note, nfb-calibration reference)
**Risk Level:** 🟢 Low

## Verdict
The plan is accurate and well-grounded in the actual codebase. Every assumption it makes was verified against real files. Implementation is a straightforward transcription of `.ai-factory/notes/27-meditation-notes-service.md`, and the surrounding scaffolding (entity, migration, proto, module `forFeature`, grpc controller) all already exist exactly as the plan claims.

## Context Gates
- **Architecture (`ARCHITECTURE.md`):** ✅ PASS. `@InjectRepository(MeditationNote)` stays confined to `MeditationNotesModule` (`forFeature` is already registered in `meditation-notes.module.ts:9`). No cross-module entity access. Service owns business logic; controller stays thin. Aligned.
- **Rules (`RULES.md`):** ✅ PASS. Plan explicitly forbids the non-null assertion operator (Task 2), keeps logs lean / no logger (Task 1), and never logs PII. The `@Payload()` + `@GrpcCurrentUser()` rule is controller-scoped (next milestone) and not in this plan's scope.
- **Roadmap:** ⚠️ WARN (non-blocking). No `ROADMAP.md` linkage is mentioned for this service-implementation milestone. Consider referencing the parent meditation-notes roadmap item, but this does not block implementation.

## Verified Correct
- **Imports (Task 1):** `RpcException` from `@nestjs/microservices` + `import { status as GrpcStatus } from '@grpc/grpc-js'` match `nfb-calibration.service.ts:4–5` exactly. Reference is correct.
- **DB constraints (Task 2):** Migration `1780461720539` confirms the partial unique index `UQ_meditation_notes_session ... WHERE session_id IS NOT NULL` → `23505` → `ALREADY_EXISTS` is correct. The FK `FK_meditation_notes_session_id ... ON DELETE SET NULL` means `23503` only fires on insert of a now-deleted session, and the detached re-save with `sessionId = null` is sound (the partial unique index does not apply to NULL, so the retry cannot collide).
- **Entity shape:** `sessionId: string | null` is nullable in both entity and migration, so `note.sessionId = null` type-checks cleanly. `noteText` defaults to `''`. Matches.
- **Method signatures:** `create(userId, sessionId, poseName, noteText)`, `updateText(noteId, userId, noteText)`, `list(userId, pageSize, pageToken)` line up with proto `CreateNoteRequest` / `UpdateNoteRequest` / `ListNotesRequest` (userId injected by interceptor, absent from messages). Consistent.
- **No migration needed:** Correctly noted — the table migration already exists. Plan does not erroneously scaffold a new one.
- **Pagination direction:** `ORDER BY createdAt DESC` + `createdAt < :cursor` is the correct direction for newest-first paging into older rows.

## Non-Blocking Suggestions

1. **Cursor tie-break on equal `createdAt` (Task 4) — minor data-correctness edge.** Pagination keyed solely on `createdAt < :cursor` can skip or duplicate rows when two notes share an identical `createdAt` timestamp across a page boundary. In normal use (one note per session end) collisions are effectively impossible, so this is acceptable, but if robustness is desired add a secondary key (e.g. `(createdAt, id)` composite cursor). Reference note accepts the simple form; flagging only.

2. **Untrusted `pageToken` decoding (Task 4) — minor robustness.** A garbage/hand-crafted `page_token` decodes to a non-timestamp string and is passed straight into `andWhere('n.createdAt < :cursor')`, which Postgres rejects with `invalid input syntax for type timestamp with time zone` — surfacing as an opaque `UNKNOWN` RPC error rather than `INVALID_ARGUMENT`. No data leak (caller only ever queries their own `userId`), so not a security issue, but consider validating the decoded cursor with `Number.isNaN(new Date(cursor).getTime())` and throwing `INVALID_ARGUMENT` — mirrors the existing pattern in `nfb-calibration.service.ts:21`.

3. **`catch (err: any)` typing.** The reference uses `catch (err: any)`. Task 5 only runs `npm run build`, which will pass, but if the project's ESLint enforces `@typescript-eslint/no-explicit-any`, `npm run lint` would flag it. `catch (err: unknown)` with a narrowing check (`typeof err === 'object' && err && 'code' in err`) avoids the `any` entirely while satisfying the no-non-null-assertion rule. Optional.

## Positive Notes
- Plan correctly delegates implementation detail to the reference note instead of duplicating it, while pinning exact error codes, status mappings, and immutability rules.
- Dependency ordering between tasks (1 → 2/3/4 → 5) is correct.
- Explicitly calls out immutability of `poseName` / `sessionId` in `updateText`, preventing a common accidental-overwrite bug.

None of the suggestions block implementation; the plan is solid as written.

PLAN_REVIEW_PASS
