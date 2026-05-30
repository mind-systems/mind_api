# Plan: GET /nfb-calibrations REST endpoint in NfbCalibrationModule

## Context
Expose the existing `NfbCalibrationService.list()` over HTTP so the web dashboard can fetch a user's calibration history. Extends the service signature to support optional `deviceSerial`, `offset` pagination, and `total` count while preserving the existing gRPC contract (proto documents `limit = 0` as "server default" — see `proto/nfb_calibration.proto:50`).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Service signature update

- [x] **Task 1: Update `NfbCalibrationService.list()` to support optional deviceSerial, offset, and total — preserve `limit = 0` proto semantics**
  Files: `src/nfb-calibration/nfb-calibration.service.ts`
  Change the signature to `list(userId: string, deviceSerial?: string, limit = 50, offset = 0): Promise<[NfbCalibrationRecord[], number]>`. Build a `FindOptionsWhere<NfbCalibrationRecord>` starting with `{ userId }`, and add `deviceSerial` to the where clause only when it is a non-empty string (skip the WHERE filter when `undefined` or `""`).
  **Limit handling — important:** the gRPC proto contract (`proto/nfb_calibration.proto:50`) documents `int32 limit = 2; // 0 = server default (50)`. The TypeScript default parameter (`limit = 50`) only triggers on `undefined`, so a gRPC caller passing `0` would otherwise produce `take: 0` and return an empty array. Compute `take` defensively:
  ```ts
  const take = Math.min(limit && limit > 0 ? limit : 50, 200);
  ```
  Then call `this.repo.findAndCount({ where, order: { createdAt: 'DESC' }, take, skip: offset })`. Import `FindOptionsWhere` from `typeorm`.

- [x] **Task 2: Update gRPC controller call site — preserve prior strict `deviceSerial` semantics**
  Files: `src/nfb-calibration/nfb-calibration.grpc.controller.ts`
  The service now returns `[records, total]` and treats empty `deviceSerial` as "no filter" — this is a behavior change versus the previous body (`where: { userId, deviceSerial }`), which filtered by literal empty string. The proto does **not** declare `"" = all devices`, so we keep the gRPC surface strict by translating empty `request.deviceSerial` to a sentinel that re-imposes the old behavior at the call site. Concretely, do **not** rely on the new "skip if empty" service behavior for gRPC:
  ```ts
  const [records] = await this.nfbCalibrationService.list(
    user.sub,
    request.deviceSerial,     // pass through as-is; if "" the service skips the filter
    request.limit,            // 0 is handled by the service's `limit > 0` guard
    0,
  );
  ```
  Two behavior notes are intentional and accepted by this plan:
  - Empty `device_serial` now returns records for **all** of the caller's devices (previously returned the empty set). The current mobile client (`mind_mobile/lib/Bci/NfbCalibrationGrpcApi.dart:28`) always sends a real serial, so no production regression. If the strict-empty behavior must be preserved instead, add `if (!request.deviceSerial) throw new RpcException({ code: GrpcStatus.INVALID_ARGUMENT, message: 'deviceSerial is required' });` before the service call — but the spec (`notes/10-web-dashboard-rest-api-spec.md:191`) explicitly accepts "empty string for all", so we adopt that here.
  - `limit = 0` continues to mean "server default (50)" per the proto contract — guaranteed by Task 1's guard.

  Keep the proto response unchanged: `return { records: records.map(toProtoNfbCalibrationRecord) };` (no `total` field — the proto has none and we are not modifying the contract here).

### Phase 2: REST controller

- [x] **Task 3: Add query DTO for list endpoint**
  Files: `src/nfb-calibration/dto/list-nfb-calibrations-query.dto.ts`
  Create `ListNfbCalibrationsQueryDto` with three optional fields, following the pattern used by `src/sessions/dto/list-runs-query.dto.ts`:
  - `deviceSerial?: string` — `@IsString() @IsOptional()`
  - `limit?: number` — `@Type(() => Number) @IsInt() @Min(1) @Max(200) @IsOptional()`
  - `offset?: number` — `@Type(() => Number) @IsInt() @Min(0) @IsOptional()`

  The global transforming `ValidationPipe` (`main.ts:80-86`) leaves missing query params as `undefined`, which combines correctly with the service defaults (`limit = 50`, `offset = 0`).

- [x] **Task 4: Create REST controller for nfb-calibrations** (depends on Tasks 1, 3)
  Files: `src/nfb-calibration/nfb-calibration.rest.controller.ts`
  Mirror the layout of `src/sessions/sessions.controller.ts`. Use `@Controller('nfb-calibrations')` with `@UseGuards(JwtAuthGuard)`. Single handler:
  ```ts
  @Get()
  async list(
    @Query() query: ListNfbCalibrationsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const [records, total] = await this.nfbCalibrationService.list(
      user.sub,
      query.deviceSerial,
      query.limit,
      query.offset,
    );
    return { records, total };
  }
  ```
  Imports: `JwtAuthGuard` from `../users/guards/jwt-auth.guard`, `CurrentUser` from `../users/decorators/current-user.decorator`, `JwtPayload` (type-only) from `../users/interfaces/auth.interface`, `NfbCalibrationService` from `./nfb-calibration.service`, `ListNfbCalibrationsQueryDto` from `./dto/list-nfb-calibrations-query.dto`.
  **Response shape note:** records are returned as the raw `NfbCalibrationRecord` entity. The entity has no sensitive columns (`userId` belongs to the authenticated caller; all other fields are calibration metrics) and TypeORM property names are already camelCase, so the HTTP shape matches what the spec calls `NfbCalibrationRecordDto[]` without a separate mapper.

### Phase 3: Module wiring

- [x] **Task 5: Register REST controller in NfbCalibrationModule** (depends on Task 4)
  Files: `src/nfb-calibration/nfb-calibration.module.ts`
  Add `NfbCalibrationRestController` to the `controllers` array alongside `NfbCalibrationGrpcController`. `AuthModule` is already present in `imports` (`nfb-calibration.module.ts:9`) and `AuthModule` exports `JwtAuthGuard` (`src/users/auth.module.ts:53-62`) — no other module-level changes needed.

## Commit Plan
- **Commit 1** (after tasks 1-2): "Extend NfbCalibrationService.list with optional deviceSerial, offset, and total count" — preserves gRPC `limit = 0` semantics; documents the empty-`deviceSerial` behavior change in the commit body.
- **Commit 2** (after tasks 3-5): "Add GET /nfb-calibrations REST endpoint"

<!-- orchestrator-sessions
planner: 56f7d9da-9390-4a01-9494-a33b576098b3
elapsed: 686
implementer: 555309ee-c9c1-41cf-8ee0-7dd2708243d6
-->
