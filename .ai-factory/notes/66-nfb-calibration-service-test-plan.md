# NFB Calibration Service — Test Plan

**Date:** 2026-06-25
**Source:** roadmap-test-coverage agent

## Source Overview

The `NfbCalibrationService` is a gRPC service provider that records neurofeedback calibration data and retrieves historical calibration records for a user. It wraps a TypeORM repository for the `NfbCalibrationRecord` entity, which stores device-specific calibration parameters (frequencies, power measurements, bandwidth, etc.) along with validation status.

## Instantiation

Direct construction:
```typescript
const service = new NfbCalibrationService(mockRepo);
```

The service requires only one dependency:
- **`Repository<NfbCalibrationRecord>`** — TypeORM repository injected as `@InjectRepository(NfbCalibrationRecord)`. Mock using Jest factory functions.

**Mock setup example:**
```typescript
function makeRepo() {
  return {
    create: jest.fn(),
    save: jest.fn(),
    findAndCount: jest.fn(),
  };
}
```

## Existing Coverage

None — spec file does not exist.

## Test Cases

### `constructor()`

- **should instantiate with a repository when passed a Repository<NfbCalibrationRecord>**
  - No setup needed
  - Basic injection test

### `record(userId: string, req: RecordNfbCalibrationRequest): Promise<NfbCalibrationRecord>`

#### Valid timestamp path

- **should create and save a calibration record when calibratedAt is a valid ISO timestamp**
  - Setup: `req.calibratedAt = new Date().toISOString()`
  - Mock: `repo.create().mockReturnValue(entity)`, `repo.save(entity).mockResolvedValue(entity)`
  - Assert: `repo.save()` was called with the created entity; returned entity has all fields

- **should map all request fields to entity fields when saving**
  - Setup: Provide a fully populated `RecordNfbCalibrationRequest` with all numeric fields and deviceSerial
  - Mock: `repo.create()`, `repo.save()`
  - Assert: `repo.create()` was called with an object containing all mapped fields (userId, deviceSerial, calibratedAt, isValid, failReason, frequencies, bandwidths, etc.)

- **should set failReason to null when request does not provide failReason (optional field)**
  - Setup: `req.failReason = undefined`
  - Mock: `repo.create()`, `repo.save()`
  - Assert: Created entity has `failReason: null`

- **should preserve failReason string when request provides it**
  - Setup: `req.failReason = 'signal too weak'`
  - Mock: `repo.create()`, `repo.save()`
  - Assert: Created entity has `failReason: 'signal too weak'`

- **should convert calibratedAt string to Date object before saving**
  - Setup: `req.calibratedAt = '2026-06-25T12:34:56Z'`
  - Mock: `repo.create()`, `repo.save()`
  - Assert: `repo.create()` was called with `calibratedAt` as a Date, not a string

#### Invalid timestamp path

- **should throw RpcException with code INVALID_ARGUMENT when calibratedAt is not a valid timestamp**
  - Setup: `req.calibratedAt = 'not-a-date'`
  - Assert: `RpcException` thrown with `code: GrpcStatus.INVALID_ARGUMENT`

- **should throw RpcException with message "Invalid calibratedAt timestamp" when calibratedAt parses to NaN**
  - Setup: `req.calibratedAt = '0000-00-00'` (or any string that parses to invalid Date)
  - Assert: `RpcException` thrown with message containing "Invalid calibratedAt timestamp"

- **should not call repo.create() when calibratedAt is invalid**
  - Setup: `req.calibratedAt = 'invalid'`
  - Assert: `repo.create()` was not called

- **should not call repo.save() when calibratedAt is invalid**
  - Setup: `req.calibratedAt = 'invalid'`
  - Assert: `repo.save()` was not called

### `list(userId: string, deviceSerial?: string, limit?: number, offset?: number): Promise<[NfbCalibrationRecord[], number]>`

#### Query construction with filters

- **should filter by userId when called**
  - Setup: `userId = 'user-123'`
  - Mock: `repo.findAndCount().mockResolvedValue([[], 0])`
  - Assert: `findAndCount()` was called with `where: { userId: 'user-123' }`

- **should include deviceSerial in where clause when deviceSerial is provided and non-empty**
  - Setup: `deviceSerial = 'DEV-456'`
  - Mock: `repo.findAndCount()`
  - Assert: `findAndCount()` was called with `where: { userId, deviceSerial: 'DEV-456' }`

- **should not include deviceSerial in where clause when deviceSerial is undefined**
  - Setup: `deviceSerial = undefined`
  - Mock: `repo.findAndCount()`
  - Assert: `findAndCount()` was called with `where: { userId }` only

- **should not include deviceSerial in where clause when deviceSerial is empty string**
  - Setup: `deviceSerial = ''`
  - Mock: `repo.findAndCount()`
  - Assert: `findAndCount()` was called with `where: { userId }` only

- **should include deviceSerial when it has length > 0**
  - Setup: `deviceSerial = 'x'` (single character)
  - Mock: `repo.findAndCount()`
  - Assert: `findAndCount()` includes deviceSerial in where clause

#### Pagination and limits

- **should order results by createdAt descending**
  - Setup: Any valid inputs
  - Mock: `repo.findAndCount()`
  - Assert: `findAndCount()` was called with `order: { createdAt: 'DESC' }`

- **should use limit value when limit > 0 and limit < 200**
  - Setup: `limit = 50`
  - Mock: `repo.findAndCount()`
  - Assert: `findAndCount()` was called with `take: 50`

- **should default limit to 50 when limit is falsy (0, null, undefined)**
  - Setup: `limit = 0` or `limit = null` or `limit = undefined`
  - Mock: `repo.findAndCount()`
  - Assert: `findAndCount()` was called with `take: 50`

- **should default limit to 50 when limit is undefined and no argument passed**
  - Setup: No limit argument
  - Mock: `repo.findAndCount()`
  - Assert: `findAndCount()` was called with `take: 50`

- **should cap limit to 200 when limit > 200**
  - Setup: `limit = 300`
  - Mock: `repo.findAndCount()`
  - Assert: `findAndCount()` was called with `take: 200`

- **should cap limit to 200 even when user provides very large number**
  - Setup: `limit = 999999`
  - Mock: `repo.findAndCount()`
  - Assert: `findAndCount()` was called with `take: 200`

- **should apply offset as skip parameter**
  - Setup: `offset = 10`
  - Mock: `repo.findAndCount()`
  - Assert: `findAndCount()` was called with `skip: 10`

- **should default offset to 0 when not provided**
  - Setup: No offset argument
  - Mock: `repo.findAndCount()`
  - Assert: `findAndCount()` was called with `skip: 0`

#### Result handling

- **should return [records, count] tuple when findAndCount succeeds**
  - Setup: Any valid inputs
  - Mock: `repo.findAndCount().mockResolvedValue([[record1, record2], 2])`
  - Assert: Function returns a tuple `[Array<NfbCalibrationRecord>, number]`

- **should return empty array with count 0 when no records match**
  - Setup: `userId = 'nonexistent'`
  - Mock: `repo.findAndCount().mockResolvedValue([[], 0])`
  - Assert: Result is `[[], 0]`

- **should return correct count even if records array is empty**
  - Setup: Query with no matches
  - Mock: `repo.findAndCount().mockResolvedValue([[], 5])` (5 in the database but at different offset)
  - Assert: Result count is 5

- **should propagate repository errors when findAndCount fails**
  - Setup: Any inputs
  - Mock: `repo.findAndCount().mockRejectedValue(new Error('DB error'))`
  - Assert: Promise rejects with the error

## Gotchas

1. **Date parsing validation**: `Number.isNaN(calibratedAt.getTime())` is the only guard against invalid timestamps. Test with boundary cases like '0000-00-00', empty string, 'invalid', null coercion.

2. **Falsy limit check**: The expression `limit && limit > 0` treats 0 as falsy, defaulting to 50. Negative numbers are also treated as invalid (not > 0), so they default to 50 as well.

3. **String length check for deviceSerial**: The guard is `deviceSerial && deviceSerial.length > 0`. This means empty string '' is skipped, but a single character 'x' is included.

4. **Optional fields**: `failReason` is the only nullable field in the request. All other frequency/power/bandwidth numeric fields are required (non-nullable in the entity).

5. **Pagination cursor**: The `createdAt` descending order means newest records come first; offset works as skip. No cursor-based pagination logic is present — only offset/take pagination.

6. **No validation of numeric ranges**: Frequencies, power, bandwidth fields are not validated for reasonable ranges (negative, NaN, etc.) — they are passed through as-is.

7. **TypeORM repository contract**: The test must mock `repo.create()` and `repo.save()` for `record()`, and `repo.findAndCount()` for `list()`. These are the only TypeORM methods used.
