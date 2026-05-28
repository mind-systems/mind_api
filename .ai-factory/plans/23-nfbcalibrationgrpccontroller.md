# Plan: NfbCalibrationGrpcController

## Context
Implement the gRPC controller for `NfbCalibrationService` (RPCs `record` and `list`) modelled on `BciDevicesGrpcController`, wiring the existing `NfbCalibrationService` to the generated proto types and mapping entity ↔ proto with the project's conventions (ISO-8601 timestamps, proto3 empty-string for nullable strings).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Mapper + Controller

- [x] **Task 1: Add `toProtoNfbCalibrationRecord` mapper**
  Files: `src/grpc/grpc-mappers.ts`
  Append a new mapper that converts a `NfbCalibrationRecord` entity (from `src/nfb-calibration/entities/nfb-calibration-record.entity.ts`) to the generated `NfbCalibrationRecord` proto message (from `proto/generated/nfb_calibration.ts`). Add a type-only import for the entity (`import type { NfbCalibrationRecord } from '../nfb-calibration/entities/nfb-calibration-record.entity';`) and for the proto message (alias to avoid name collision, e.g. `import type { NfbCalibrationRecord as NfbCalibrationRecordProto } from '../../proto/generated/nfb_calibration';`). Field mapping rules — must follow the existing `toProtoBciDevice` style:
  - `id`, `deviceSerial`, `isValid` — copy through
  - `calibratedAt: entity.calibratedAt.toISOString()`
  - `createdAt: entity.createdAt.toISOString()`
  - `failReason: entity.failReason ?? ''` — project convention: DB `null` → proto3 empty string
  - All seven numeric calibration fields (`individualFrequency`, `individualPeakFrequencyPower`, `individualPeakFrequencySuppression`, `individualBandwidth`, `individualNormalizedPower`, `lowerFrequency`, `upperFrequency`) — copy through unchanged
  Place the function next to `toProtoBciDevice` at the bottom of the file to keep gRPC entity mappers grouped.

- [x] **Task 2: Implement `NfbCalibrationGrpcController` body** (depends on Task 1)
  Files: `src/nfb-calibration/nfb-calibration.grpc.controller.ts`
  Replace the stub controller body. Use `src/bci/bci-devices.grpc.controller.ts` as the exact template — apply class-level `@Controller()`, `@UseFilters(GrpcExceptionFilter)`, `@UseInterceptors(GrpcAuthInterceptor)` (these decorators replace the bare `@Controller()` currently on the stub). Keep the existing constructor injection of `NfbCalibrationService` (rename the parameter to `nfbCalibrationService` to match `BciDeviceService` naming style if desired, otherwise keep `service`). Imports to add: `UseFilters`, `UseInterceptors` from `@nestjs/common`; `GrpcMethod`, `Payload`, `RpcException` from `@nestjs/microservices`; `status as GrpcStatus` from `@grpc/grpc-js`; `RecordNfbCalibrationRequest`, `ListNfbCalibrationsRequest`, `ListNfbCalibrationsResponse`, `NfbCalibrationRecord as NfbCalibrationRecordProto` from `../../proto/generated/nfb_calibration`; `GrpcExceptionFilter` from `../grpc/grpc-exception.filter`; `GrpcAuthInterceptor` from `../grpc/grpc-auth.interceptor`; `GrpcCurrentUser` from `../grpc/decorators/grpc-current-user.decorator`; `type { JwtPayload }` from `../users/interfaces/auth.interface`; `toProtoNfbCalibrationRecord` from `../grpc/grpc-mappers`. Implement two methods:
  - `@GrpcMethod('NfbCalibrationService', 'record')` — signature `async record(@Payload() request: RecordNfbCalibrationRequest, @GrpcCurrentUser() user: JwtPayload | null): Promise<NfbCalibrationRecordProto>`. Null-check `user` → `throw new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' })`. Delegate: `const entity = await this.nfbCalibrationService.record(user.sub, request);` and `return toProtoNfbCalibrationRecord(entity);`.
  - `@GrpcMethod('NfbCalibrationService', 'list')` — signature `async list(@Payload() request: ListNfbCalibrationsRequest, @GrpcCurrentUser() user: JwtPayload | null): Promise<ListNfbCalibrationsResponse>`. Same null-check pattern. Delegate: `const records = await this.nfbCalibrationService.list(user.sub, request.deviceSerial, request.limit);` then `return { records: records.map(toProtoNfbCalibrationRecord) };`.
  Both methods are unary (no streaming). All field-mapping happens inside `toProtoNfbCalibrationRecord` — the controller never touches `.toISOString()` or `failReason ?? ''` directly, which keeps mapping centralised in `grpc-mappers.ts` per project convention.

<!-- orchestrator-sessions
planner: 0ccf2409-8a2b-4469-bccb-fd56bf146f29
elapsed: 316
implementer: bb94a499-039f-4402-8879-dcd089637a88
-->
