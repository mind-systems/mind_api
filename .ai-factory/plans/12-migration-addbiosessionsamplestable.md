# Plan: Migration `AddBioSessionSamplesTable`

## Context
Create a TypeORM migration that adds the `bio_session_samples` table — storage backing for Phase 19's `BiometricStreamEngine`. The table mirrors `session_stream_samples` exactly (camelCase quoted columns, CASCADE FK to `module_sessions`).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Migration

- [x] **Task 1: Generate migration scaffold via CLI**
  Files: `src/migrations/<timestamp>-AddBioSessionSamplesTable.ts` (created by CLI)
  Run `npx typeorm migration:create src/migrations/AddBioSessionSamplesTable` from `mind_api/` root. Do NOT hand-craft the timestamp — let the CLI generate it. This creates an empty class `AddBioSessionSamplesTable<timestamp>` with empty `up`/`down` methods.

- [x] **Task 2: Implement `up()` — create table, FK, index** (depends on Task 1)
  Files: `src/migrations/<timestamp>-AddBioSessionSamplesTable.ts`
  Mirror `src/migrations/1774863293946-InitialSchema.ts:285-298` exactly. Use a single `CREATE TABLE` statement with **quoted camelCase** column names, then a separate `CREATE INDEX` statement.

  Columns (in this order, matching `session_stream_samples`):
  - `"id"` — `uuid NOT NULL DEFAULT uuid_generate_v4()`
  - `"moduleSessionId"` — `uuid NOT NULL`
  - `"samples"` — `jsonb NOT NULL`
  - `"flushedAt"` — `TIMESTAMP NOT NULL`
  - `"createdAt"` — `TIMESTAMP NOT NULL DEFAULT now()`

  Constraints (inside the same `CREATE TABLE`):
  - `CONSTRAINT "PK_bio_session_samples_id" PRIMARY KEY ("id")`
  - `CONSTRAINT "FK_bio_session_samples_moduleSessionId" FOREIGN KEY ("moduleSessionId") REFERENCES "module_sessions"("id") ON DELETE CASCADE`

  Index (separate `queryRunner.query` call after the table):
  - `CREATE INDEX "IDX_bio_session_samples_moduleSessionId" ON "bio_session_samples" ("moduleSessionId")`

  Do NOT add `name:` mapping — camelCase identifiers are quoted so PostgreSQL preserves them as-is, allowing the upcoming entity (Task in milestone 13) to use bare `moduleSessionId` properties without column-name mapping.

- [x] **Task 3: Implement `down()` — drop index, then table** (depends on Task 2)
  Files: `src/migrations/<timestamp>-AddBioSessionSamplesTable.ts`
  Mirror the reverse order from `InitialSchema.down` (`src/migrations/1774863293946-InitialSchema.ts:305-308`):
  1. `DROP INDEX IF EXISTS "IDX_bio_session_samples_moduleSessionId"`
  2. `DROP TABLE IF EXISTS "bio_session_samples"`

  Both wrapped in `await queryRunner.query(...)`. The FK is dropped automatically with the table; no separate `DROP CONSTRAINT` needed.

- [x] **Task 4: Verify migration runs and reverts cleanly** (depends on Task 3)
  Files: none (verification only)
  Run `npm run migration:run` against a local dev database to confirm `up()` succeeds and the table/index appear with the expected names. Then run `npm run migration:revert` to confirm `down()` removes them. Re-run `npm run migration:run` to leave the database in the applied state. If `npm run build` is part of the project's quality gate, run it to ensure the new file compiles.

<!-- orchestrator-sessions
planner: 98dd0953-6a1d-436b-a255-eca58d8045bb
elapsed: 431
implementer: ad0a9a2d-37f3-41f1-8e1b-9f2d5d5497e8
-->
