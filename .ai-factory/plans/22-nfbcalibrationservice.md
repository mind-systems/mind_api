# Plan: NfbCalibrationService

## Context
Implement the two business-logic methods of `NfbCalibrationService` — append-only `record` and history `list` — backing the `NfbCalibrationService` gRPC service. The entity, module wiring, repository injection, and generated proto types already exist; this milestone only adds the two methods.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Implementation

- [x] **Task 1: Implement `record` and `list` in `NfbCalibrationService`**
  Files: `src/nfb-calibration/nfb-calibration.service.ts`
  Add two methods to the existing class (constructor and `@InjectRepository(NfbCalibrationRecord)` are already in place; do not touch them).

  Imports to add at top of file:
  - `RecordNfbCalibrationRequest` from `../../proto/generated/nfb_calibration` (interface is exported from the generated stubs — see `proto/generated/nfb_calibration.ts:40`).

  Method 1 — `record(userId: string, req: RecordNfbCalibrationRequest): Promise<NfbCalibrationRecord>`:
  - Build a new entity via `this.repo.create({...})` mapping fields one-to-one from `req` onto the entity columns:
    - `userId` (from method arg)
    - `deviceSerial: req.deviceSerial`
    - `calibratedAt: new Date(req.calibratedAt)` — proto carries ISO-8601 string, entity column is `Date`/`timestamptz`.
    - `isValid: req.isValid`
    - `failReason: req.failReason || null` — proto3 default `""` → DB `null` (matches project convention; entity column is `nullable: true`).
    - All seven numeric fields copied verbatim: `individualFrequency`, `individualPeakFrequencyPower`, `individualPeakFrequencySuppression`, `individualBandwidth`, `individualNormalizedPower`, `lowerFrequency`, `upperFrequency`.
    - Do NOT set `id` or `createdAt` — handled by `@PrimaryGeneratedColumn('uuid')` and `@CreateDateColumn` respectively.
  - `return this.repo.save(entity)` — unconditional insert; no upsert, no dedup (every calibration run is a distinct historical record, per the migration which has no unique constraint).

  Method 2 — `list(userId: string, deviceSerial: string, limit: number): Promise<NfbCalibrationRecord[]>`:
  - `return this.repo.find({ where: { userId, deviceSerial }, order: { createdAt: 'DESC' }, take: limit || 50 })`.
  - `limit || 50` handles proto3 `int32` default of `0` (meaning "server default"); negative values are not specified by the milestone and need no special handling.

  No additional error handling, no logging (per `RULES.md` — keep logs lean; this method has no key business outcome to log). No new imports beyond `RecordNfbCalibrationRequest`. Follow the `BciDeviceService` style (`src/bci/bci-device.service.ts`) for repository access patterns.

<!-- orchestrator-sessions
planner: 1b2cb689-2f8c-4da6-93a1-289dc120e7cd
elapsed: 330
implementer: 8e727f82-4aba-4cef-a4ab-ba42eba4ebc6
-->
