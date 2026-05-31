# Spec — Phase 25: validate `calibratedAt` in NFB calibration record

**Date:** 2026-05-31
**Source:** code review note 14 §Phase 20 LOW
**Target:** `src/nfb-calibration/nfb-calibration.service.ts` (`record`)
**Scope:** no migration, no proto, no schema change.

## Problem
`NfbCalibrationService.record` does `calibratedAt: new Date(req.calibratedAt)` with no validation. An empty (proto3 default `''`) or malformed `calibratedAt` yields an `Invalid Date`, which fails the `NOT NULL timestamptz` insert with an opaque `QueryFailedError` surfaced to the caller as a generic error.

## Fix
At the top of `record`:
```ts
const calibratedAt = new Date(req.calibratedAt);
if (Number.isNaN(calibratedAt.getTime())) {
  throw new RpcException({
    code: GrpcStatus.INVALID_ARGUMENT,
    message: 'Invalid calibratedAt timestamp',
  });
}
```
- Import `RpcException` from `@nestjs/microservices` and `status as GrpcStatus` from `@grpc/grpc-js` (same imports as `BciDeviceService`).
- Use the validated `calibratedAt` Date in the created entity (do not re-parse).

## Notes
- The gRPC `record` RPC always carries `calibratedAt` as a string; this also guards any future REST `POST` reusing the service.
- Everything else in `record` stays identical.
