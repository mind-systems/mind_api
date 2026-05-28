# Code Review (Round 2): NfbCalibrationRecord entity + NfbCalibrationModule skeleton

**Plan:** `21-nfbcalibrationrecord-entity-nfbcalibrationmodule-skeleton.md`
**Branch:** `dev`
**Scope reviewed:** all staged code changes — `src/app.module.ts`, `src/nfb-calibration/**`.

## Changes since Review 1

- Seven numeric columns in `NfbCalibrationRecord` were retyped from `type: 'float'` to `type: 'double precision'`, matching the `double precision` columns created by `1779993063433-AddNfbCalibrationRecordsTable`. This closes the only finding from Review 1 (latent precision-downgrade hazard on the next `migration:generate`).

## Verification performed

- `npx tsc --noEmit` — clean, no errors.
- Read every new/modified `.ts` file in full.
- Cross-checked every entity column against `src/migrations/1779993063433-AddNfbCalibrationRecordsTable.ts` row-by-row:
  - `id uuid` ↔ `@PrimaryGeneratedColumn('uuid')` ✓
  - `user_id uuid NOT NULL` ↔ `@Column('uuid', { name: 'user_id' })` ✓
  - `device_serial varchar NOT NULL` ↔ `@Column({ name: 'device_serial' })` ✓ (TypeORM default for `string` → `varchar`)
  - `calibrated_at timestamptz NOT NULL` ↔ `@Column({ name: 'calibrated_at', type: 'timestamptz' })` ✓
  - `is_valid boolean NOT NULL` ↔ `@Column({ name: 'is_valid' })` ✓ (boolean inferred)
  - `fail_reason varchar DEFAULT NULL` ↔ `@Column({ name: 'fail_reason', type: 'varchar', nullable: true })` ✓
  - Seven `double precision NOT NULL` numeric columns ↔ `@Column({ name: '…', type: 'double precision' })` ✓
  - `created_at timestamptz NOT NULL DEFAULT now()` ↔ `@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })` ✓
  - Index `IDX_nfb_calibration_records_user_device` on `(user_id, device_serial)` ↔ `@Index(['userId', 'deviceSerial'])` (non-unique) ✓
  - FK `user_id → users.id ON DELETE CASCADE` — DB-side only, no `@ManyToOne` on the entity; consistent with `BciDevice`, which also keeps the FK DB-only.
- Cross-checked `NfbCalibrationModule` against `src/bci/bci.module.ts` (the reference pattern) — same `[AuthModule, TypeOrmModule.forFeature([Entity])]` import shape, same single controller + service.
- Cross-checked `AppModule` registration: import at `src/app.module.ts:17`, `NfbCalibrationModule` placed in the `imports` array directly after `BciModule` at `src/app.module.ts:36`. Grouping is sensible.
- RULES.md gates: no `!` non-null assertions, no logging added (vacuously compliant with PII / lean-logs rules). `@Payload()`-with-`@GrpcCurrentUser()` rule is not triggered yet — the controller has no methods.
- ARCHITECTURE.md gates: entity lives inside its owning module, `@InjectRepository` confined to `NfbCalibrationService`, no cross-module repo access, `synchronize` unchanged.

## Findings

None.

REVIEW_PASS
