# Plan: Migration AddMeditationNotesTable

## Context
Create the `meditation_notes` table via a TypeORM migration so meditation notes (one per session, opaque pose label) persist and survive deletion of their originating session.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Migration

- [x] **Task 1: Generate the migration file via CLI**
  Files: `src/migrations/<timestamp>-AddMeditationNotesTable.ts` (created)
  Run `npx typeorm migration:create src/migrations/AddMeditationNotesTable` to scaffold the file with a CLI-generated timestamp. NEVER hand-craft the timestamp prefix. This produces an empty `up`/`down` migration class implementing `MigrationInterface`.

- [x] **Task 2: Implement the `up` body** (depends on Task 1)
  Files: `src/migrations/<timestamp>-AddMeditationNotesTable.ts`
  Fill the `up(queryRunner)` method using raw `queryRunner.query(...)` calls, following the pattern in `src/migrations/1779990145496-AddBioSessionSamplesTable.ts` (double-quoted identifiers, named PK/FK/index constraints).
  - `CREATE TABLE "meditation_notes"` with columns:
    - `"id" uuid NOT NULL DEFAULT uuid_generate_v4()`, named PK constraint `PK_meditation_notes_id`
    - `"user_id" uuid NOT NULL`, FK `FK_meditation_notes_user_id` REFERENCES `"users"("id") ON DELETE CASCADE`
    - `"session_id" uuid` (nullable), FK `FK_meditation_notes_session_id` REFERENCES `"module_sessions"("id") ON DELETE SET NULL` — **critical: SET NULL, not CASCADE**, so notes survive session deletion
    - `"pose_name" varchar NOT NULL` (opaque client string, no FK, no check constraint)
    - `"note_text" text NOT NULL DEFAULT ''`
    - `"created_at" timestamptz NOT NULL DEFAULT now()`
    - `"updated_at" timestamptz NOT NULL DEFAULT now()`
  - `CREATE INDEX "IDX_meditation_notes_user_id" ON "meditation_notes" ("user_id")`
  - `CREATE INDEX "IDX_meditation_notes_session_id" ON "meditation_notes" ("session_id")`
  - `CREATE UNIQUE INDEX "UQ_meditation_notes_session" ON "meditation_notes" ("session_id") WHERE "session_id" IS NOT NULL` — partial unique index enforcing one note per session while allowing multiple detached (null) notes per user.

- [x] **Task 3: Implement the `down` body** (depends on Task 2)
  Files: `src/migrations/<timestamp>-AddMeditationNotesTable.ts`
  Reverse the `up` in inverse order: `DROP INDEX IF EXISTS` for `UQ_meditation_notes_session`, `IDX_meditation_notes_session_id`, `IDX_meditation_notes_user_id`, then `DROP TABLE IF EXISTS "meditation_notes"` (which removes the FKs).

- [x] **Task 4: Apply and verify the migration** (depends on Task 3)
  Files: none
  Run `npm run build` then `npm run migration:run` and confirm it succeeds with no errors. Verify in psql with `\d meditation_notes`: nullable `session_id`, the two regular indexes, and the partial unique index on `session_id` are all present. Optionally sanity-check the rollback with `npm run migration:revert` then re-run `npm run migration:run`.
