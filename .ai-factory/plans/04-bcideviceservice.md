# Plan: `BciDeviceService`

## Context
Implement the three service methods (`listForUser`, `register`, `delete`) on the existing `BciDeviceService` stub at `src/bci/bci-device.service.ts`. Encodes the modular-monolith rules: ownership checks live in the service, `@UpdateDateColumn` is force-bumped explicitly on idempotent re-register, and unique-constraint races are caught and re-fetched.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Implement service methods

- [x] **Task 1: Implement `listForUser(userId)` on `BciDeviceService`**
  Files: `src/bci/bci-device.service.ts`
  Replace the empty body of the existing stub class with a `listForUser` method:
  ```ts
  async listForUser(userId: string): Promise<BciDevice[]> {
    return this.bciDevicesRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
  }
  ```
  Keep the existing constructor and `@InjectRepository(BciDevice)` wiring as-is. Use `Repository.find({ where, order })` — the same pattern as `src/realtime/services/startup-recovery.service.ts`. The `IDX_bci_devices_user_id` index from the migration backs the `userId` filter; the row count per user is small, so no pagination is needed.

- [x] **Task 2: Implement `register(userId, serial)` with explicit `updated_at` bump and unique-violation race handling** (depends on Task 1)
  Files: `src/bci/bci-device.service.ts`
  Add an idempotent `register` method that force-bumps `updated_at` when the row already exists (so `List` ordering reflects the most-recent re-pair), and re-fetches on unique-constraint races. Use pattern (a) from the milestone description — `repo.update(..., { updatedAt: () => 'CURRENT_TIMESTAMP' })` followed by `findOneByOrFail`:
  ```ts
  async register(userId: string, serial: string): Promise<BciDevice> {
    // Fast path: row already exists — force-bump updated_at so List ordering reflects re-pair.
    // .save(existingRow) unchanged would NOT move @UpdateDateColumn; explicit update is required.
    const updateResult = await this.bciDevicesRepo.update(
      { userId, serial },
      { updatedAt: () => 'CURRENT_TIMESTAMP' },
    );
    if ((updateResult.affected ?? 0) > 0) {
      return this.bciDevicesRepo.findOneByOrFail({ userId, serial });
    }

    // Insert path. Catch unique-violation race (concurrent insert between the UPDATE above
    // and this INSERT) and re-fetch — Postgres SQLSTATE 23505.
    try {
      const created = this.bciDevicesRepo.create({ userId, serial });
      return await this.bciDevicesRepo.save(created);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code?: string }).code === '23505'
      ) {
        // Concurrent register won the race — re-fetch the row.
        // Do NOT bump updated_at here: the other writer already set it.
        return this.bciDevicesRepo.findOneByOrFail({ userId, serial });
      }
      throw err;
    }
  }
  ```
  Add `QueryFailedError` to the existing `typeorm` import line. Import the existing `BciDevice` entity (already imported in the stub). Do not log the `serial` value (it's user-tied identifying data; per `.ai-factory/RULES.md` "Keep logs lean" — no entry/exit logs; per "Never log sensitive data" treat device serial as PII-adjacent). No logger needed for this path.

- [x] **Task 3: Implement `delete(userId, id)` with ownership checks** (depends on Task 2)
  Files: `src/bci/bci-device.service.ts`
  Add the `delete` method; ownership and not-found errors are raised here (not in the controller), using `RpcException` + `GrpcStatus` codes consistent with `src/realtime/sync-stream.grpc.controller.ts`:
  ```ts
  async delete(userId: string, id: string): Promise<void> {
    const row = await this.bciDevicesRepo.findOneBy({ id });
    if (!row) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: 'BCI device not found',
      });
    }
    if (row.userId !== userId) {
      throw new RpcException({
        code: GrpcStatus.PERMISSION_DENIED,
        message: 'BCI device belongs to another user',
      });
    }
    await this.bciDevicesRepo.delete({ id });
  }
  ```
  Add the new imports at the top of the file:
  ```ts
  import { RpcException } from '@nestjs/microservices';
  import { status as GrpcStatus } from '@grpc/grpc-js';
  ```
  Match the import style already used in `src/realtime/sync-stream.grpc.controller.ts` (named import of `status as GrpcStatus`). Do not perform the ownership check by adding `userId` to the `findOneBy` filter — the milestone requires a `PERMISSION_DENIED` (not `NOT_FOUND`) response when the row exists but belongs to another user, which requires the two-step fetch-then-check sequence above.

### Phase 2: Verification

- [x] **Task 4: Verify the project compiles and lints** (depends on Task 3)
  Files: (no file changes)
  From `mind_api/`, run:
  - `npm run build` — confirm TypeScript compiles with the new method signatures and imports.
  - `npm run lint` — confirm no lint errors in `src/bci/bci-device.service.ts`.
  No runtime verification needed here — the gRPC controller wiring is the next milestone.
