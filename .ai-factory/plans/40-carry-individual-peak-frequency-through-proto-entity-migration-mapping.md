# Plan: Carry `individual_peak_frequency` through proto + entity + migration + mapping

## Context
neiry's calibration data carries two distinct values — `individualFrequency` and `individualPeakFrequency` — but the NFB calibration contract/storage only persists the former, so mobile loses the captured peak on every server-driven cache refresh. This milestone adds the bare `individual_peak_frequency` field end-to-end (proto → generated stubs → entity → migration → service write → response mapping) on the mind_api side, mirroring the existing `individual_frequency` exactly, so calibration round-trips durably.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

> Reference implementation to mirror in every step: the existing `individual_frequency` (proto `float`) / `individualFrequency` (entity + mapper) field. The new field is `individual_peak_frequency` (proto) / `individualPeakFrequency` (TS). Backward-compat: existing rows have no peak — the column is nullable and the response mapper coalesces null to `0` (mobile defaults it from `individualFrequency` when absent). Do NOT touch the unrelated `individual_peak_frequency_power` / `individual_peak_frequency_suppression` fields. Project rule: never use the non-null assertion operator (`!`).

### Phase 1: Contract (proto + stubs)

- [x] **Task 1: Add `individual_peak_frequency` to both proto messages**
  Files: `proto/nfb_calibration.proto`
  Add `float individual_peak_frequency = 14;` to message `NfbCalibrationRecord` (current max field is 13 = `created_at`; 14 is the next free number — place it right after the `created_at` line so existing numbers stay untouched; do NOT renumber). Add `float individual_peak_frequency = 12;` to message `RecordNfbCalibrationRequest` (current max field is 11 = `upper_frequency`; 12 is next free). Type `float`, matching `individual_frequency`.

- [x] **Task 2: Regenerate ts-proto stubs** (depends on Task 1)
  Files: `proto/generated/nfb_calibration.ts` (committed, regenerated output)
  Run `npm run proto:gen`. Confirm the regenerated `NfbCalibrationRecord` and `RecordNfbCalibrationRequest` TypeScript interfaces now include `individualPeakFrequency: number`. The `proto/generated/` files are tracked in git — commit the regenerated stub. Do not hand-edit generated files.

### Phase 2: Storage (entity + migration)

- [x] **Task 3: Add `individualPeakFrequency` column to the entity** (depends on Task 2)
  Files: `src/nfb-calibration/entities/nfb-calibration-record.entity.ts`
  Add a column mirroring the existing `individualFrequency` declaration — `@Column({ name: 'individual_peak_frequency', type: 'double precision' })`. The existing numeric columns are `NOT NULL`; this one must be nullable for backward-compat with pre-existing rows, so use `@Column({ name: 'individual_peak_frequency', type: 'double precision', nullable: true })` and type the property `individualPeakFrequency: number | null;`. Place it next to `individualFrequency`.

- [x] **Task 4: Create migration adding the column** (depends on Task 3)
  Files: `src/migrations/<generated-timestamp>-AddIndividualPeakFrequencyToNfbCalibration.ts`
  Scaffold via CLI only — `npm run migration:create src/migrations/AddIndividualPeakFrequencyToNfbCalibration` (never hand-craft the timestamp). `up()`: `ALTER TABLE "nfb_calibration_records" ADD COLUMN "individual_peak_frequency" double precision` (nullable — no `NOT NULL`, no default, since existing rows have no value). `down()`: `ALTER TABLE "nfb_calibration_records" DROP COLUMN "individual_peak_frequency"`. Mirror the SQL style of `1779993063433-AddNfbCalibrationRecordsTable.ts` (table name is `nfb_calibration_records`). Verify it applies with `npm run migration:run`.

### Phase 3: Mapping (service write + response mapper)

- [x] **Task 5: Persist the field on write in the service** (depends on Task 4)
  Files: `src/nfb-calibration/nfb-calibration.service.ts`
  In the `record` method's `this.repo.create({...})` call, add `individualPeakFrequency: req.individualPeakFrequency,` alongside the existing `individualFrequency: req.individualFrequency,` line. No transformation needed — straight pass-through, exactly like the sibling numeric fields.

- [x] **Task 6: Return the field in the response mapper** (depends on Task 5)
  Files: `src/grpc/grpc-mappers.ts`
  In `toProtoNfbCalibrationRecord`, add `individualPeakFrequency: entity.individualPeakFrequency ?? 0,` next to the existing `individualFrequency: entity.individualFrequency,` line. The `?? 0` mirrors the `failReason: entity.failReason ?? ''` null-coalescing pattern already in this mapper and gives legacy (null) rows a sane value. The gRPC controller (`nfb-calibration.grpc.controller.ts`) and REST controller need no changes — they delegate to the service and this mapper.

## Commit Plan
- **Commit 1** (after tasks 1-2): "Add individual_peak_frequency to NFB calibration proto and regenerate stubs"
- **Commit 2** (after tasks 3-4): "Add individual_peak_frequency column and migration to NFB calibration"
- **Commit 3** (after tasks 5-6): "Persist and return individual_peak_frequency in NFB calibration"
