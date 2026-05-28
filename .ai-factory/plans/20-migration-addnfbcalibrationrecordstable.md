# Plan: Migration AddNfbCalibrationRecordsTable

## Context
Create a new TypeORM migration that adds the `nfb_calibration_records` table — a historical log of NFB calibration runs per user/device with all measured individual frequency parameters.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Migration scaffold

- [x] **Task 1: Generate migration file via CLI**
  Files: `src/migrations/<timestamp>-AddNfbCalibrationRecordsTable.ts` (new)
  Run `npx typeorm migration:create src/migrations/AddNfbCalibrationRecordsTable` from the `mind_api/` directory. Do NOT hand-craft the timestamp — the CLI assigns it. The command produces an empty migration class with the correct `<timestamp>-AddNfbCalibrationRecordsTable.ts` filename and `AddNfbCalibrationRecordsTable<timestamp>` class name implementing `MigrationInterface`.

### Phase 2: Implement migration

- [x] **Task 2: Implement `up()` — create table** (depends on Task 1)
  Files: `src/migrations/<timestamp>-AddNfbCalibrationRecordsTable.ts`
  In the generated migration, implement `up(queryRunner: QueryRunner)` to execute a single `CREATE TABLE "nfb_calibration_records"` statement. Follow the column/style conventions used in `src/migrations/1779369537954-AddBciDevicesTable.ts` (quoted identifiers, aligned columns, inline `PRIMARY KEY` / `FOREIGN KEY` constraints).

  Columns (in order, all with snake_case names):
  - `"id"` — `uuid NOT NULL DEFAULT uuid_generate_v4()`
  - `"user_id"` — `uuid NOT NULL`
  - `"device_serial"` — `character varying NOT NULL`
  - `"calibrated_at"` — `TIMESTAMP WITH TIME ZONE NOT NULL`
  - `"is_valid"` — `boolean NOT NULL`
  - `"fail_reason"` — `character varying DEFAULT NULL`
  - `"individual_frequency"` — `double precision NOT NULL`
  - `"individual_peak_frequency_power"` — `double precision NOT NULL`
  - `"individual_peak_frequency_suppression"` — `double precision NOT NULL`
  - `"individual_bandwidth"` — `double precision NOT NULL`
  - `"individual_normalized_power"` — `double precision NOT NULL`
  - `"lower_frequency"` — `double precision NOT NULL`
  - `"upper_frequency"` — `double precision NOT NULL`
  - `"created_at"` — `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`

  Constraints:
  - `CONSTRAINT "PK_nfb_calibration_records_id" PRIMARY KEY ("id")`
  - `CONSTRAINT "FK_nfb_calibration_records_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`

  No unique constraint — every calibration run is a distinct historical record.

- [x] **Task 3: Create composite index** (depends on Task 2)
  Files: `src/migrations/<timestamp>-AddNfbCalibrationRecordsTable.ts`
  After the `CREATE TABLE` statement, in the same `up()` method add a second `queryRunner.query` call:
  ```
  CREATE INDEX "IDX_nfb_calibration_records_user_device"
    ON "nfb_calibration_records" ("user_id", "device_serial")
  ```

- [x] **Task 4: Implement `down()` — drop index and table** (depends on Task 3)
  Files: `src/migrations/<timestamp>-AddNfbCalibrationRecordsTable.ts`
  Implement `down(queryRunner: QueryRunner)` to revert the migration:
  1. `DROP INDEX IF EXISTS "IDX_nfb_calibration_records_user_device"`
  2. `DROP TABLE IF EXISTS "nfb_calibration_records"`
  Use `IF EXISTS` for both statements, matching the pattern in `src/migrations/1779990145496-AddBioSessionSamplesTable.ts`.

### Phase 3: Verify

- [x] **Task 5: Run migration locally** (depends on Task 4)
  Files: none
  Run `npm run migration:run` to apply, verify the table and index exist in the dev DB, then run `npm run migration:revert` to confirm `down()` works cleanly. Re-apply with `npm run migration:run` to leave the dev DB in the migrated state.

<!-- orchestrator-sessions
planner: 442a2945-3534-411f-bd92-a285ea84558c
elapsed: 353
implementer: a5d7ad1b-941c-4a51-9d8b-a0b446b63eb2
-->
