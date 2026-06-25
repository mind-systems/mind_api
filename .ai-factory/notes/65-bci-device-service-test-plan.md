# BCI Device Service — Test Plan

**Date:** 2026-06-25
**Source:** roadmap-test-coverage agent

## Source Overview

The `BciDeviceService` manages pairing and tracking of BCI (Brain-Computer Interface) devices per user. It provides three main operations: listing devices in reverse chronological order, registering a new device (or re-pairing an existing one with updated timestamp), and deleting a device with ownership verification. The service handles the race condition between concurrent registrations of the same device by catching PostgreSQL unique constraint violations (`SQLSTATE 23505`).

## Instantiation

### Direct instantiation in tests

```typescript
const mockRepository = {
  find: jest.fn(),
  update: jest.fn(),
  findOneByOrFail: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
};

const service = new BciDeviceService(mockRepository);
```

### Via NestJS Test Module (recommended for integration tests)

```typescript
const module: TestingModule = await Test.createTestingModule({
  providers: [
    BciDeviceService,
    {
      provide: getRepositoryToken(BciDevice),
      useValue: mockRepository,
    },
  ],
}).compile();

const service = module.get<BciDeviceService>(BciDeviceService);
```

### Dependencies to mock

- **`bciDevicesRepo` (Repository<BciDevice>)**: All database operations. Mock the following methods:
  - `find({ where, order })` — used in `listForUser`
  - `update({ userId, serial }, { updatedAt })` — used in `register` fast path
  - `findOneByOrFail({ userId, serial })` and `findOneByOrFail({ id })` — used in both register and delete paths
  - `findOneBy({ id })` — used in delete to check ownership
  - `create({ userId, serial })` — used in register insert path
  - `save(entity)` — used in register insert path
  - `delete({ id })` — used in delete to remove the device

## Existing Coverage

None. No spec file exists in the repository.

## Test Cases

### listForUser(userId: string)

**Test 1:** should return empty array when user has no devices
- **Setup:** Mock `find()` to return `[]`
- **Call:** `service.listForUser('user-123')`
- **Assert:** Result is `[]`
- **Details:** Verify empty state handling

**Test 2:** should return devices ordered by updatedAt DESC
- **Setup:** Create three mock devices with different `updatedAt` timestamps; mock `find()` to return them
- **Call:** `service.listForUser('user-123')`
- **Assert:** Result contains all devices in reverse chronological order by `updatedAt`
- **Details:** Verify the `order: { updatedAt: 'DESC' }` query option is passed to `find()`

**Test 3:** should pass correct where clause to repository
- **Setup:** Mock `find()` to return any value
- **Call:** `service.listForUser('user-abc')`
- **Assert:** `find()` was called with `where: { userId: 'user-abc' }`
- **Details:** Verify userId filtering is applied

**Test 4:** should propagate repository errors
- **Setup:** Mock `find()` to reject with a database error
- **Call:** `service.listForUser('user-123')`
- **Assert:** Rejects with the same error
- **Details:** No error swallowing; upstream handles it

### register(userId: string, serial: string)

**Test 5:** should update updatedAt and return existing device when row exists
- **Setup:**
  - Mock `update()` to return `{ affected: 1 }` (indicating one row was updated)
  - Mock `findOneByOrFail()` to return an existing device entity with matching userId and serial
- **Call:** `service.register('user-123', 'DEVICE-001')`
- **Assert:**
  - `update()` was called with `{ userId: 'user-123', serial: 'DEVICE-001' }` and `{ updatedAt: () => 'CURRENT_TIMESTAMP' }`
  - `findOneByOrFail()` was called once (to fetch the bumped row)
  - Returned device matches the fetched entity
- **Details:** Fast path — tests re-pairing behavior where updatedAt is explicitly bumped

**Test 6:** should not call findOneByOrFail when update affects 0 rows
- **Setup:** Mock `update()` to return `{ affected: 0 }`
- **Call:** `service.register('user-123', 'DEVICE-002')`
- **Assert:** `findOneByOrFail()` is NOT called after the update; proceeds to insert path
- **Details:** Edge case: affected is undefined or 0

**Test 7:** should insert new device when none exists
- **Setup:**
  - Mock `update()` to return `{ affected: 0 }`
  - Mock `create()` to return a partial device object
  - Mock `save()` to return the full device entity with id and timestamps
- **Call:** `service.register('user-456', 'DEVICE-NEW')`
- **Assert:**
  - `create()` was called with `{ userId: 'user-456', serial: 'DEVICE-NEW' }`
  - `save()` was called with the created entity
  - Returned device matches the saved entity
- **Details:** Insert path — new device registration

**Test 8:** should re-fetch on unique constraint violation (SQLSTATE 23505)
- **Setup:**
  - Mock `update()` to return `{ affected: 0 }`
  - Mock `create()` to return a partial device
  - Mock `save()` to reject with a `QueryFailedError` with `code: '23505'`
  - Mock `findOneByOrFail()` to return the device that won the race
- **Call:** `service.register('user-789', 'DEVICE-RACE')`
- **Assert:**
  - `save()` was called (insertion attempt)
  - `findOneByOrFail()` was called to fetch the winning row
  - Returned device matches the fetched entity (from concurrent writer)
- **Details:** Race condition: two processes try to insert the same (userId, serial) simultaneously; one wins, the other catches and re-fetches

**Test 9:** should propagate non-uniqueness QueryFailedError
- **Setup:**
  - Mock `update()` to return `{ affected: 0 }`
  - Mock `create()` to return a partial device
  - Mock `save()` to reject with a `QueryFailedError` with a different `code` (e.g., '23502' for not-null violation)
- **Call:** `service.register('user-999', 'DEVICE-ERROR')`
- **Assert:** Rejects with the original QueryFailedError
- **Details:** Only 23505 is caught and handled; other DB errors propagate

**Test 10:** should propagate non-QueryFailedError exceptions from save
- **Setup:**
  - Mock `update()` to return `{ affected: 0 }`
  - Mock `create()` to return a partial device
  - Mock `save()` to reject with a generic Error (not QueryFailedError)
- **Call:** `service.register('user-111', 'DEVICE-OOM')`
- **Assert:** Rejects with the original error
- **Details:** Only QueryFailedError with code 23505 is handled

**Test 11:** should handle missing code property on QueryFailedError
- **Setup:**
  - Mock `update()` to return `{ affected: 0 }`
  - Mock `create()` to return a partial device
  - Mock `save()` to reject with a `QueryFailedError` with undefined `code`
- **Call:** `service.register('user-222', 'DEVICE-NOCODE')`
- **Assert:** Rejects with the QueryFailedError (since code does not match '23505')
- **Details:** Defensive: the service type-casts and checks `(err as QueryFailedError & { code?: string }).code`; missing code should not match

### delete(userId: string, id: string)

**Test 12:** should delete device owned by the user
- **Setup:**
  - Mock `findOneBy({ id: 'device-1' })` to return a device with `userId: 'user-123'`
  - Mock `delete()` to succeed
- **Call:** `service.delete('user-123', 'device-1')`
- **Assert:**
  - `findOneBy()` was called with `{ id: 'device-1' }`
  - `delete()` was called with `{ id: 'device-1' }`
  - Function resolves without error (returns undefined)
- **Details:** Happy path — user owns the device

**Test 13:** should throw NOT_FOUND when device does not exist
- **Setup:** Mock `findOneBy()` to return `null`
- **Call:** `service.delete('user-123', 'missing-device')`
- **Assert:** Rejects with `RpcException` with `code: GrpcStatus.NOT_FOUND` and message `'BCI device not found'`
- **Details:** Device lookup fails before ownership check

**Test 14:** should throw PERMISSION_DENIED when device belongs to another user
- **Setup:**
  - Mock `findOneBy()` to return a device with `userId: 'other-user'`
  - `delete()` should NOT be called
- **Call:** `service.delete('user-123', 'device-1')`
- **Assert:**
  - Rejects with `RpcException` with `code: GrpcStatus.PERMISSION_DENIED` and message `'BCI device belongs to another user'`
  - `delete()` is NOT called (fails before deletion)
- **Details:** Authorization check prevents deleting another user's device

**Test 15:** should propagate repository errors from findOneBy
- **Setup:** Mock `findOneBy()` to reject with a database error
- **Call:** `service.delete('user-123', 'device-1')`
- **Assert:** Rejects with the same error
- **Details:** Errors during lookup propagate

**Test 16:** should propagate repository errors from delete
- **Setup:**
  - Mock `findOneBy()` to return a valid device owned by the user
  - Mock `delete()` to reject with a database error
- **Call:** `service.delete('user-123', 'device-1')`
- **Assert:** Rejects with the same error
- **Details:** Errors during deletion propagate

## Gotchas

1. **QueryFailedError with optional code property**: The service uses type assertion `(err as QueryFailedError & { code?: string }).code` to safely check the error code. When mocking, ensure the mock error has the `code` property set correctly; simply passing an error with no `code` property should result in falsy comparison (not matching '23505').

2. **UpdateDateColumn behavior**: The entity uses TypeORM's `@UpdateDateColumn`, which automatically sets timestamps during `save()`. In the `register` method's fast path, the code explicitly calls `update()` with `updatedAt: () => 'CURRENT_TIMESTAMP'` to force a timestamp bump — a plain `.save()` on an unchanged entity would NOT move the timestamp. Tests must distinguish between the fast path (explicit update with forced timestamp) and insert path (auto-timestamp from @UpdateDateColumn).

3. **Affected count comparison**: The code checks `(updateResult.affected ?? 0) > 0`. The `??` operator means if `affected` is undefined, it defaults to 0. Tests should mock `affected` as either undefined or a number, not null.

4. **Race condition window**: Between `update()` and `save()` in the register flow, another concurrent request may insert the same (userId, serial) combination. Only the QueryFailedError with code '23505' is caught and re-fetched; the service does not implement retry logic beyond the single catch block.

5. **RpcException vs standard Error**: The delete method throws `RpcException` (gRPC exceptions), not standard JavaScript errors. Tests must check for RpcException with `code` and `message` properties, not `.toString()` or `.name`.

6. **No async/sync timer mixin**: The service is purely synchronous in control flow (all methods are async but contain no timers, intervals, or fire-and-forget promises). Mock the repository synchronously as needed.

7. **Ownership check happens before deletion**: The delete method validates ownership (`row.userId !== userId`) before calling `delete()`. This is important for tests that verify authorization — ensure mocks prevent `delete()` calls in negative cases.

