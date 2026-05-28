# Code Review: NfbCalibrationService

## Scope
Reviewed the staged change to `src/nfb-calibration/nfb-calibration.service.ts` adding the two milestone methods `record` and `list`. The new plan and plan-review files were also reviewed; they are documentation only and have no runtime impact.

## Files Reviewed
- `src/nfb-calibration/nfb-calibration.service.ts` (modified — read in full)
- `src/nfb-calibration/entities/nfb-calibration-record.entity.ts` (context)
- `proto/generated/nfb_calibration.ts` (context — `RecordNfbCalibrationRequest` shape)
- `src/nfb-calibration/nfb-calibration.module.ts` (context — wiring)
- `src/bci/bci-device.service.ts` (style precedent)

## Cross-checks

- **Field mapping**: every column on the `NfbCalibrationRecord` entity that needs a value (userId, deviceSerial, calibratedAt, isValid, failReason, 7 numeric fields) is covered by the `repo.create({...})` call. `id` and `createdAt` are intentionally omitted (handled by `@PrimaryGeneratedColumn` and `@CreateDateColumn`). No missing or extra fields against `RecordNfbCalibrationRequest` (proto/generated/nfb_calibration.ts:40-52).
- **Types**:
  - `calibratedAt`: proto `string` (ISO-8601) → `new Date(req.calibratedAt)` → entity `Date` ✓.
  - `failReason`: proto `string` → `req.failReason || null` → entity `string | null` ✓ (proto3 default `""` becomes DB `null` per project convention).
  - All seven numeric proto `float`/`double` fields → entity `double precision` ✓.
- **Repository semantics**: `this.repo.save(entity)` on a freshly `create()`d entity with no `id` produces an INSERT — append-only, no upsert. Matches the milestone ("insert unconditionally, no upsert, no dedup") and the migration (no unique constraint).
- **`list` query**: `where: { userId, deviceSerial }` is backed by `@Index(['userId', 'deviceSerial'])` on the entity (migration adds `IDX_nfb_calibration_records_user_device`). `order: { createdAt: 'DESC' }` matches the ROADMAP wording ("ordered by `created_at DESC`"). `take: limit || 50` correctly handles proto3 `int32` default of `0`.
- **Module wiring**: `NfbCalibrationModule` imports `TypeOrmModule.forFeature([NfbCalibrationRecord])` and provides `NfbCalibrationService`. `@InjectRepository(NfbCalibrationRecord)` is therefore in-bounds and module-local — matches the modular monolith rule.
- **Rules (`RULES.md`)**:
  - No non-null assertion (`!`) used.
  - No logging of sensitive data (no logging at all — appropriate for this layer).
  - `@Payload()` / `@GrpcCurrentUser()` rule does not apply (service, not controller).

## Runtime considerations

- `new Date(req.calibratedAt)` on an empty / malformed string yields `Invalid Date`; TypeORM will then hand `'Invalid Date'` to Postgres and the INSERT will fail with `invalid input syntax for type timestamp`. The mobile client contract treats `calibratedAt` as required and the milestone explicitly excludes extra validation, so this is acceptable behavior — surfaced as an error at save time, not silently corrupted.
- `take: limit || 50` is not upper-bounded; a caller could request an arbitrarily large page. The roadmap entry does not specify a cap, and the RPC is internal/trusted, so this is not a finding — noted in the plan-review already.
- No race conditions: append-only insert, no shared state, no concurrency hazard. The `list` query is read-only.
- No N+1, no eager relations, no lazy loaders involved.

## Findings

None.

REVIEW_PASS
