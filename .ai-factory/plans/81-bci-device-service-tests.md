# Test Plan: BCI Device Service Tests

## Context
`BciDeviceService` (`src/bci/bci-device.service.ts`) manages per-user BCI device pairing: `listForUser` (DESC ordering), `register` (timestamp-bump fast path / insert path / 23505 race re-fetch), and `delete` (NOT_FOUND + PERMISSION_DENIED ownership guard). No spec file exists; this plan covers all 16 branches.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/bci/bci-device.service.spec.ts`

## Target Spec File
`src/bci/bci-device.service.spec.ts`

## Conventions (from existing specs)
- Jest, direct instantiation: `new BciDeviceService(repo as any)`.
- A `makeRepo()` helper returning `{ find, update, findOneByOrFail, findOneBy, create, save, delete }` as `jest.fn()`.
- Fresh repo + service in `beforeEach`.
- `QueryFailedError` imported from `typeorm`; `RpcException` from `@nestjs/microservices`; `status as GrpcStatus` from `@grpc/grpc-js`.
- Build a `QueryFailedError` and attach `code` via cast/assignment (the service reads `(err as QueryFailedError & { code?: string }).code`). The constructor takes three args — make it explicit:
  ```ts
  const err = new QueryFailedError('', [], new Error('duplicate key'));
  (err as QueryFailedError & { code?: string }).code = '23505';
  ```
- `create` is **synchronous** — mock it with `mockReturnValue(entity)`, not `mockResolvedValue`. The service calls `create(...)` synchronously and only `await`s `save(...)`.
- Inspect thrown `RpcException` payloads via the public `getError()` accessor — never `.error` (declared `private readonly`, so reading it fails ts-jest / `npm run build`). Match the `async/await + rejects` convention from existing specs:
  ```ts
  await expect(service.delete('u1', 'id1')).rejects.toBeInstanceOf(RpcException);
  try {
    await service.delete('u1', 'id1');
    fail('expected RpcException');
  } catch (e) {
    expect((e as RpcException).getError()).toMatchObject({
      code: GrpcStatus.NOT_FOUND,
      message: 'BCI device not found',
    });
  }
  ```

## Tasks

### Phase 1: BciDeviceService — listForUser

- [x] **Task 1: `listForUser` query and ordering**
  Files: `src/bci/bci-device.service.spec.ts`
  Test cases:
  - `should return an empty array when the user has no devices`
  - `should return devices as returned by the repository (ordered by updatedAt DESC)`
  - `should call find with where { userId } and order { updatedAt: 'DESC' }`
  - `should propagate errors thrown by find`

### Phase 2: BciDeviceService — register (fast path)

- [x] **Task 2: `register` existing-row fast path**
  Files: `src/bci/bci-device.service.spec.ts`
  Test cases:
  - `should call update with { userId, serial } and a updatedAt function returning 'CURRENT_TIMESTAMP'` (assert the second arg's `updatedAt` is a function and that invoking it yields `'CURRENT_TIMESTAMP'`)
  - `should re-fetch via findOneByOrFail and return the bumped row when update affected > 0`
  - `should not call create or save when update affected > 0`

### Phase 3: BciDeviceService — register (insert path)

- [x] **Task 3: `register` new-row insert path**
  Files: `src/bci/bci-device.service.spec.ts`
  Test cases:
  - `should proceed to insert when update returns affected 0` (no `findOneByOrFail` on the fast branch)
  - `should proceed to insert when update returns affected undefined` (covers `affected ?? 0`)
  - `should call create with { userId, serial } and save the created entity`
  - `should return the saved entity on a successful insert`

### Phase 4: BciDeviceService — register (unique-constraint race)

- [x] **Task 4: `register` 23505 race catch and error propagation**
  Files: `src/bci/bci-device.service.spec.ts`
  Test cases:
  - `should re-fetch via findOneByOrFail and return the winning row when save throws QueryFailedError with code '23505'`
  - `should propagate a QueryFailedError whose code is not '23505'`
  - `should propagate a QueryFailedError with an undefined code`
  - `should propagate a non-QueryFailedError thrown by save`

### Phase 5: BciDeviceService — delete

- [x] **Task 5: `delete` ownership guards and happy path**
  Files: `src/bci/bci-device.service.spec.ts`
  Test cases:
  - `should look up the row via findOneBy { id } and delete { id } when the user owns the device`
  - `should resolve with undefined on a successful delete`
  - `should throw RpcException with NOT_FOUND when findOneBy returns null` (assert `getError()` matches `{ code: GrpcStatus.NOT_FOUND, message: 'BCI device not found' }`)
  - `should not call delete when the device is not found`
  - `should throw RpcException with PERMISSION_DENIED when row.userId !== userId` (assert `getError()` matches `{ code: GrpcStatus.PERMISSION_DENIED, message: 'BCI device belongs to another user' }`)
  - `should not call delete when the device belongs to another user`
  - `should propagate errors thrown by delete when the user owns the device`

## Notes for the implementer
- Only `QueryFailedError` instances with `code === '23505'` trigger the re-fetch; every other error (different code, missing code, non-`QueryFailedError`) must propagate unchanged.
- The fast-vs-insert branch hinges on `(updateResult.affected ?? 0) > 0` — cover both a numeric `affected` and `undefined`.
- Assert the forced timestamp bump by checking `update`'s second argument `updatedAt` is a function returning `'CURRENT_TIMESTAMP'`, not a literal value.
- For the delete guard cases, assert the thrown value is an `RpcException` instance and read its payload via `getError()` (returns `{ code, message }`). Do not access `.error` directly — it is `private readonly` and the type-checked spec will not compile.
