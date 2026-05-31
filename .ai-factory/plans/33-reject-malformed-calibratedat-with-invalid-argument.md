# Plan: Reject malformed `calibratedAt` with `INVALID_ARGUMENT`

## Context
Guard `NfbCalibrationService.record` against malformed/empty `calibratedAt` so an `Invalid Date` is rejected with a clean gRPC `INVALID_ARGUMENT` instead of surfacing an opaque `QueryFailedError` from the `NOT NULL timestamptz` insert.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Validate calibratedAt

- [x] **Task 1: Add `RpcException` INVALID_ARGUMENT guard at top of `record`**
  Files: `src/nfb-calibration/nfb-calibration.service.ts`
  Add two imports mirroring `src/bci/bci-device.service.ts`: `import { RpcException } from '@nestjs/microservices';` and `import { status as GrpcStatus } from '@grpc/grpc-js';`.
  At the very top of `record`, before `this.repo.create(...)`, parse and validate once:
  ```ts
  const calibratedAt = new Date(req.calibratedAt);
  if (Number.isNaN(calibratedAt.getTime())) {
    throw new RpcException({
      code: GrpcStatus.INVALID_ARGUMENT,
      message: 'Invalid calibratedAt timestamp',
    });
  }
  ```
  Then change the entity creation to reuse the validated value: `calibratedAt,` instead of `calibratedAt: new Date(req.calibratedAt),` (do NOT re-parse). Everything else in `record` stays identical.
