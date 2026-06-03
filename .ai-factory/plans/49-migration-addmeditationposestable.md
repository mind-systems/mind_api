# Plan: Migration AddMeditationPosesTable

## Context
Introduce a static `meditation_poses` reference table seeded with the six curated poses (currently hardcoded as slugs on mobile), via a migration-only change with no admin endpoint.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Migration

- [x] **Task 1: Generate migration file**
  Files: `src/migrations/<timestamp>-AddMeditationPosesTable.ts` (generated)
  Run `npx typeorm migration:create src/migrations/AddMeditationPosesTable` to scaffold the file with a CLI-generated timestamp prefix. Never hand-craft the timestamp. This produces an empty `up`/`down` skeleton implementing `MigrationInterface`, matching the style of existing migrations like `src/migrations/1779369537954-AddBciDevicesTable.ts`.

- [x] **Task 2: Implement `up()` — create table and seed rows** (depends on Task 1)
  Files: `src/migrations/<timestamp>-AddMeditationPosesTable.ts`
  In `up()`, create the table using `queryRunner.query` with quoted identifiers, following the `AddBciDevicesTable` formatting:
  - `id uuid NOT NULL DEFAULT uuid_generate_v4()` — use `uuid_generate_v4()`, NOT `gen_random_uuid()` (project convention).
  - `slug character varying NOT NULL`
  - `display_order smallint NOT NULL`
  - `CONSTRAINT "PK_meditation_poses_id" PRIMARY KEY ("id")`
  - `CONSTRAINT "UQ_meditation_poses_slug" UNIQUE ("slug")`
  Then issue a second `queryRunner.query` with a single `INSERT INTO "meditation_poses" ("slug", "display_order") VALUES (...)` seeding all six rows inline: `easy`/1, `lotus`/2, `half_lotus`/3, `seiza`/4, `chair`/5, `savasana`/6. No separate seeder file. No `user_id`, `created_at`, `updated_at`, or soft-delete columns — this is static reference data.

- [x] **Task 3: Implement `down()` — drop table** (depends on Task 2)
  Files: `src/migrations/<timestamp>-AddMeditationPosesTable.ts`
  In `down()`, run `DROP TABLE IF EXISTS "meditation_poses"` (seed rows go with it). Match the `IF EXISTS` style used in `AddBciDevicesTable.down()`.

- [x] **Task 4: Verify build and migration run** (depends on Task 3)
  Files: none
  Run `npm run build` to confirm the migration compiles, then `npm run migration:run` against the dev database to confirm the table is created and seeded without errors. Optionally confirm reversibility with `npm run migration:revert` followed by `npm run migration:run` again.
