# Plan: Migration `AddBciDevicesTable`

## Context
Create a new TypeORM migration that adds the `bci_devices` table for storing BCI hardware serials registered per user, with a unique `(user_id, serial)` constraint and an index backing the `List` query.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Generate and implement migration

- [x] **Task 1: Scaffold the migration file via TypeORM CLI**
  Files: `src/migrations/<timestamp>-AddBciDevicesTable.ts` (generated)
  Run `npx typeorm migration:create src/migrations/AddBciDevicesTable` from the `mind_api/` directory. Do NOT hand-craft the timestamp prefix — let the CLI produce it. Verify a new file appears under `src/migrations/` matching the pattern `<timestamp>-AddBciDevicesTable.ts` and that its class name is `AddBciDevicesTable<timestamp>` (matching the format of existing `1774863293946-InitialSchema.ts`).

- [x] **Task 2: Implement `up()` — create `bci_devices` table with constraints and index** (depends on Task 1)
  Files: `src/migrations/<timestamp>-AddBciDevicesTable.ts`
  Inside `up(queryRunner)`, issue the following raw SQL via `queryRunner.query(...)`, following the style of `1774863293946-InitialSchema.ts` (snake_case columns, named constraints, `uuid_generate_v4()` for PK default — the `uuid-ossp` extension is already created by `InitialSchema`):

  1. `CREATE TABLE "bci_devices"` with columns:
     - `"id"         uuid NOT NULL DEFAULT uuid_generate_v4()`
     - `"user_id"    uuid NOT NULL`
     - `"serial"     character varying NOT NULL`
     - `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`
     - `"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`
     - `CONSTRAINT "PK_bci_devices_id" PRIMARY KEY ("id")`
     - `CONSTRAINT "UQ_bci_devices_user_serial" UNIQUE ("user_id", "serial")`
     - `CONSTRAINT "FK_bci_devices_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`
  2. `CREATE INDEX "IDX_bci_devices_user_id" ON "bci_devices" ("user_id")`

  Use `timestamptz` (`TIMESTAMP WITH TIME ZONE`) as the milestone explicitly specifies `timestamptz` for `created_at`/`updated_at`.

- [x] **Task 3: Implement `down()` — reverse drops** (depends on Task 2)
  Files: `src/migrations/<timestamp>-AddBciDevicesTable.ts`
  Inside `down(queryRunner)`, reverse the operations in opposite order:
  1. `DROP INDEX IF EXISTS "IDX_bci_devices_user_id"`
  2. `DROP TABLE IF EXISTS "bci_devices"`

  Dropping the table will automatically remove the named PK, UNIQUE, and FK constraints, matching the pattern used in `InitialSchema.down()`.

- [x] **Task 4: Verify migration runs and reverts cleanly** (depends on Task 3)
  Files: (no file changes)
  From `mind_api/`, run:
  - `npm run build` — confirm TypeScript compiles.
  - `npm run migration:run` — apply the new migration locally (against the dev DB started via `make up`). Confirm the `bci_devices` table, the `UQ_bci_devices_user_serial` unique constraint, and the `IDX_bci_devices_user_id` index exist.
  - `npm run migration:revert` — confirm the table and index are dropped.
  - `npm run migration:run` again to leave the schema in the migrated state.

  Note: migrations also run automatically on startup (`migrationsRun: true` in `database.config.ts`), so this verification only needs the manual CLI runs above.
