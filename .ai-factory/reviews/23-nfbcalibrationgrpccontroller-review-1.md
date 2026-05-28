# Code Review: NfbCalibrationGrpcController

## Scope of Review
Changes under review:
- `src/grpc/grpc-mappers.ts` — added `toProtoNfbCalibrationRecord` mapper
- `src/nfb-calibration/nfb-calibration.grpc.controller.ts` — implemented `record` and `list` gRPC methods

Read in full: both modified files, plus surrounding context (`bci-devices.grpc.controller.ts`, `grpc-auth.interceptor.ts`, `grpc-current-user.decorator.ts`, `nfb-calibration.service.ts`, `nfb-calibration.module.ts`, `nfb-calibration-record.entity.ts`, `proto/generated/nfb_calibration.ts`, `auth.interface.ts`, `bci.module.ts`, `app.module.ts`, migration `1779993063433-AddNfbCalibrationRecordsTable.ts`).

## Correctness Verification

### Mapper (`grpc-mappers.ts`)
- All 13 proto fields are populated; field name and type match the generated `NfbCalibrationRecord` interface line-for-line.
- `calibratedAt.toISOString()` / `createdAt.toISOString()` — entity columns are `timestamptz` mapped to `Date`, conversion correct.
- `failReason: entity.failReason ?? ''` — symmetric with the service-side `req.failReason || null` write path: empty string → DB null → proto empty string. Matches the proto3 convention documented at `proto/generated/nfb_calibration.ts:26-27`.
- Numeric fields (`double precision` columns) are passed through unchanged. The proto uses `float`, so a `double precision` value will be downcast on the wire — acceptable for IEEE 754 single-precision calibration constants, and consistent with the upstream proto definition the team approved in task 19.
- Type-only imports correctly aliased (`NfbCalibrationRecord as NfbCalibrationRecordProto`) to avoid collision with the entity class.

### Controller (`nfb-calibration.grpc.controller.ts`)
- Class decorators (`@Controller()`, `@UseFilters(GrpcExceptionFilter)`, `@UseInterceptors(GrpcAuthInterceptor)`) mirror `BciDevicesGrpcController` exactly.
- Both methods declared `async`, use `@Payload()` for the request and `@GrpcCurrentUser()` for the auth payload. `UNAUTHENTICATED` null-check is mandatory because `GrpcCurrentUser` is typed `JwtPayload | null` — interceptor would already reject missing tokens for non-optional auth, but the explicit guard is the project convention and keeps the type narrow.
- `record` passes the proto request through to the service unchanged. `NfbCalibrationService.record(userId, req)` accepts `RecordNfbCalibrationRequest` from the generated stubs — type identity preserved end-to-end.
- `list` passes `request.deviceSerial` and `request.limit`. Service applies `take: limit || 50`, so proto3 default `0` is treated as the "server default 50" semantic documented in `proto/generated/nfb_calibration.ts:57-58`. Correct.
- Response shapes: `record` returns the proto message via the mapper; `list` returns `{ records: [...] }` matching `ListNfbCalibrationsResponse`. No streaming RPCs, matches the proto's `requestStream: false / responseStream: false` declarations.

### DI Graph
- `NfbCalibrationModule` imports `AuthModule` and `TypeOrmModule.forFeature([NfbCalibrationRecord])`.
- `GrpcAuthInterceptor` depends on `JwtService`, `SessionService`, `Reflector` — all transitively provided through `AuthModule`. No additional wiring needed.
- `NfbCalibrationModule` is registered in `AppModule` (`src/app.module.ts:36`). Verified.

### Runtime Concerns
- **Migration**: `1779993063433-AddNfbCalibrationRecordsTable.ts` exists with matching column names; runs automatically via `migrationsRun: true`. No risk.
- **`main.ts` protoPath**: `nfb_calibration.proto` is not yet listed in the bootstrap protoPath array. This is a known open task on the roadmap (Phase 20 line 75) and explicitly scoped out of this controller implementation. The controller compiles and registers cleanly; runtime `UNIMPLEMENTED` will be resolved when that next task lands. Not a defect against this plan.
- **Race / concurrency**: no shared state, no streaming, no in-memory caches. Service insert is a single TypeORM `save` against an immutable-append table. No race surface introduced.
- **Security**: identity is taken exclusively from the JWT payload (`user.sub`), never from the request body. `userId` is intentionally absent from both proto request shapes. Ownership scoping on `list` is enforced server-side via `where: { userId, deviceSerial }`.

### Type Safety
- All proto imports are value imports (needed for runtime decorator metadata indirectly — though only `RecordNfbCalibrationRequest`, `ListNfbCalibrationsRequest`, `ListNfbCalibrationsResponse`, and `NfbCalibrationRecord` are used as types; the value side is harmless tree-shake-eligible).
- `JwtPayload` and `NfbCalibrationRecord` entity imports are `type`-only where appropriate.
- No `any` casts in the controller or mapper.

## Findings
None.

REVIEW_PASS
