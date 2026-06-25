# Test Plan: NFB Calibration Service Tests

## Context
`NfbCalibrationService` (`src/nfb-calibration/nfb-calibration.service.ts`) records neurofeedback calibration data and lists historical records for a user, wrapping a TypeORM `Repository<NfbCalibrationRecord>`. No spec file exists; this plan covers its two methods — `record()` and `list()` — purely through a mocked repository.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/nfb-calibration/nfb-calibration.service.spec.ts`

## Target Spec File
`src/nfb-calibration/nfb-calibration.service.spec.ts`

## Notes for the implementer
- Instantiate directly: `new NfbCalibrationService(repo as any)` (follow the pattern in `src/bci/bci-device.service.spec.ts`).
- Mock repo factory: `{ create: jest.fn(), save: jest.fn(), findAndCount: jest.fn() }` — these are the only repository methods used.
- `RecordNfbCalibrationRequest` (from `proto/generated/nfb_calibration`) is a flat interface: `deviceSerial`, `calibratedAt` (string), `isValid`, `failReason`, plus numeric fields `individualFrequency`, `individualPeakFrequency`, `individualPeakFrequencyPower`, `individualPeakFrequencySuppression`, `individualBandwidth`, `individualNormalizedPower`, `lowerFrequency`, `upperFrequency`. Build a `makeReq(overrides)` helper returning a fully populated valid request.
- For error assertions use `RpcException` from `@nestjs/microservices` and `status as GrpcStatus` from `@grpc/grpc-js`.

## Tasks

### Phase 1: `record()` — valid path field mapping

- [x] **Task 1: `record()` persists and maps fields on a valid timestamp**
  Files: `src/nfb-calibration/nfb-calibration.service.spec.ts`
  Test cases:
  - `should create and save a record when calibratedAt is a valid ISO timestamp`
  - `should return the entity resolved by repo.save`
  - `should pass all request fields through to repo.create when saving`
  - `should convert calibratedAt string into a Date instance passed to repo.create`

### Phase 2: `record()` — failReason mapping

- [x] **Task 2: `record()` maps the optional failReason field**
  Files: `src/nfb-calibration/nfb-calibration.service.spec.ts`
  Test cases:
  - `should set failReason to null when request failReason is an empty string`
  - `should set failReason to null when request failReason is undefined`
  - `should preserve failReason when request provides a non-empty string`

### Phase 3: `record()` — invalid timestamp guard

- [x] **Task 3: `record()` rejects an unparseable calibratedAt**
  Files: `src/nfb-calibration/nfb-calibration.service.spec.ts`
  Test cases:
  - `should throw RpcException with code INVALID_ARGUMENT when calibratedAt is not a valid date string`
  - `should throw RpcException with message "Invalid calibratedAt timestamp" when calibratedAt parses to NaN`
  - `should not call repo.create when calibratedAt is invalid`
  - `should not call repo.save when calibratedAt is invalid`

### Phase 4: `list()` — where clause construction

- [x] **Task 4: `list()` builds the where clause from userId and deviceSerial**
  Files: `src/nfb-calibration/nfb-calibration.service.spec.ts`
  Test cases:
  - `should query findAndCount with where userId only when deviceSerial is undefined`
  - `should omit deviceSerial from the where clause when deviceSerial is an empty string`
  - `should include deviceSerial in the where clause when deviceSerial is non-empty`
  - `should include deviceSerial when deviceSerial is a single character`

### Phase 5: `list()` — pagination, limit cap, ordering

- [x] **Task 5: `list()` applies ordering, take, and skip correctly**
  Files: `src/nfb-calibration/nfb-calibration.service.spec.ts`
  Test cases:
  - `should order by createdAt DESC`
  - `should use the provided limit as take when limit is between 1 and 200`
  - `should default take to 50 when limit is 0`
  - `should default take to 50 when limit is negative`
  - `should default take to 50 when limit argument is omitted`
  - `should cap take at 200 when limit exceeds 200`
  - `should pass offset as the skip value`
  - `should default skip to 0 when offset argument is omitted`

### Phase 6: `list()` — result passthrough

- [x] **Task 6: `list()` returns the repository tuple and propagates errors**
  Files: `src/nfb-calibration/nfb-calibration.service.spec.ts`
  Test cases:
  - `should return the [records, count] tuple resolved by findAndCount`
  - `should return an empty array with count 0 when no records match`
  - `should propagate the error when findAndCount rejects`
