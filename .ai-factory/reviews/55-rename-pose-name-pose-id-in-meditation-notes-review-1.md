# Code Review: Rename `pose_name` → `pose_id` in `meditation_notes`

**Plan:** `.ai-factory/plans/55-rename-pose-name-pose-id-in-meditation-notes.md`
**Scope reviewed:** `git diff HEAD` + `git status` — migration, entity, proto, generated stub, service, controller, mapper.
**Verdict:** 🟢 Pass — no correctness, security, or runtime issues found.

## What was checked

### Coverage — all references renamed
Swept `src/` and `proto/` for `poseName` / `pose_name`. After the change the only remaining hits are:
- `src/migrations/1780461720539-AddMeditationNotesTable.ts` — the historical `CREATE TABLE` with `"pose_name" varchar`. **Correctly left untouched** — this migration already ran against the DB; editing it would corrupt migration history. The new rename migration supersedes it.
- `src/migrations/1780524587785-RenamePoseNameToPoseIdInMeditationNotes.ts` — the literal `RENAME COLUMN pose_name TO pose_id` SQL, which must mention both names.

All application-code references (`entity`, `service` param + `repo.create`, controller `req.poseId`, mapper `entity.poseId`) are consistently renamed. No DTOs, sync journal, stats, or realtime code reference the field.

### Build
- `npm run build` (nest build) → **exit 0, clean**.
- The `tsc --noEmit` errors observed are confined to `src/realtime/services/biometric-stream-engine.service.spec.ts` (a `Partial<BioSessionSample>` cast). They are **pre-existing and unrelated** to this change, and excluded from the build (`tsconfig.build.json` excludes `**/*spec.ts`).

### Generated proto stub
- `proto/generated/meditation_notes.ts` correctly regenerated: `poseId` in both `MeditationNote` and `CreateNoteRequest`, with wire tags preserved (`writer.uint32(26)` = field 3, `writer.uint32(18)` = field 2). Field numbers unchanged → wire-compatible rename. ✅
- Note: `proto/generated/` is git-ignored (`git check-ignore` confirms), so the regenerated stub does not appear in the diff. This is expected — stubs are built artifacts. The working-tree copy is correct and the build consumes it.

### Migration
- Filename timestamp `1780524587785` > `1780461720539` (AddMeditationNotesTable) and > `1780508172536` (AddMeditationPosesTable) → **runs in correct order**, after the table exists.
- Class name suffix matches the filename timestamp. `up()`/`down()` are symmetric, valid PostgreSQL. Column type preserved (rename only). Empty table → no data migration risk.

### Proto semantics
- The field comment was correctly refreshed: `// pose UUID (or empty string), no FK, any value accepted`, and the `UpdateNoteRequest` comment updated to `pose_id`. No misleading stale wording remains.

## Non-blocking note (out of scope for this repo)
Per the monorepo proto-ownership rule, `proto/meditation_notes.proto` is the source of truth; consumers (`mind_mcp`, `mind_mobile`) must copy the updated `.proto` and regenerate their stubs, and mobile must begin sending `pose_id`. That cross-project propagation is correctly outside this `mind_api` change but should be tracked as a follow-up so the contract stays in sync end-to-end.

REVIEW_PASS
