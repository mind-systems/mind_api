# Plan Review: NfbCalibrationGrpcController

## Code Review Summary

**Files Reviewed:** 1 plan + 7 codebase files (existing controller stub, service, entity, proto, BCI reference controller, decorator, mappers)
**Risk Level:** 🟢 Low

### Context Gates
- **Architecture gate (`.ai-factory/ARCHITECTURE.md`)**: not present at the relevant path — skipped (no WARN since project follows documented module-monolith conventions in CLAUDE.md and the plan adheres).
- **Rules gate (`.ai-factory/RULES.md`)**: not present — skipped.
- **Roadmap gate (`.ai-factory/ROADMAP.md`)**: not reviewed in detail. Plan is part of the in-flight `nfb-calibration` slice (tasks 19→22 already implemented + reviewed) — alignment is implicit. No blocking issue.

### Verification of Plan Assumptions

Each assumption in the plan was cross-checked against the actual codebase:

| Plan claim | Verified |
|---|---|
| `BciDevicesGrpcController` is the canonical template (class-level `@Controller()`, `@UseFilters(GrpcExceptionFilter)`, `@UseInterceptors(GrpcAuthInterceptor)`, `RpcException` with `GrpcStatus.UNAUTHENTICATED`) | ✅ Matches `src/bci/bci-devices.grpc.controller.ts` exactly |
| `NfbCalibrationService.record(userId, req)` returns `Promise<NfbCalibrationRecord>` | ✅ Confirmed in `src/nfb-calibration/nfb-calibration.service.ts:14` |
| `NfbCalibrationService.list(userId, deviceSerial, limit)` returns `Promise<NfbCalibrationRecord[]>` | ✅ Confirmed in service line 32 |
| Service is already injected in the stub controller as `service` (constructor present, rename optional) | ✅ Confirmed |
| Generated proto file `proto/generated/nfb_calibration.ts` exports `RecordNfbCalibrationRequest`, `ListNfbCalibrationsRequest`, `ListNfbCalibrationsResponse`, `NfbCalibrationRecord` | ✅ All present |
| Proto service name is `NfbCalibrationService` with RPCs `record` and `list` (both unary) | ✅ Confirmed via `NfbCalibrationServiceControllerMethods` and `NfbCalibrationServiceService` |
| Entity fields (`id`, `deviceSerial`, `isValid`, `calibratedAt`, `createdAt`, `failReason` nullable, plus 7 numeric fields) match proto exactly | ✅ Both shapes verified line-by-line; entity has `userId` (omitted from proto by design, ✓) |
| Mapper convention: `Date.toISOString()` for timestamps, `?? ''` for nullable strings (proto3 empty-string convention) | ✅ Matches `toProtoBciDevice`, `toProtoBreathSessionDto` and the comment in `nfb_calibration.ts` line 26-27 |
| `JwtPayload` has `sub: string` accessible via `@GrpcCurrentUser()` | ✅ Confirmed (`src/users/interfaces/auth.interface.ts:3`) |
| Module already registers the controller | ✅ `nfb-calibration.module.ts:10` |

### Critical Issues
None.

### Minor Observations (non-blocking)

1. **Mapper centralization** — plan is explicit that `failReason ?? ''` and `.toISOString()` live only in the mapper. This matches the convention in `grpc-mappers.ts`. ✓
2. **Constructor parameter naming** — plan leaves the choice between `service` (current stub) and `nfbCalibrationService` (BCI style) to the implementer. The BCI controller uses the descriptive name; recommend renaming for consistency, but not a blocker.
3. **`userId` not on proto** — correct and intentional: the proto comment in `nfb_calibration.ts:39` and `:55` explicitly states "auth identity comes from metadata/interceptor, not the message". The mapper correctly omits `userId` from the projection. ✓
4. **`limit` defaulting** — the service already applies `take: limit || 50` for the `0 = server default` proto convention. Controller can pass `request.limit` through unchanged; the plan does this correctly.
5. **Security** — the `UNAUTHENTICATED` null-check on `user` is correctly required even though `GrpcAuthInterceptor` runs first, because `GrpcCurrentUser` is typed `JwtPayload | null`. Matches BCI pattern. ✓
6. **No migration required** — this is a controller-only change; entity/migration already shipped in tasks 20–21. ✓
7. **No new module wiring** — `NfbCalibrationModule` already lists the controller and imports `AuthModule` for the interceptor's transitive deps. ✓
8. **`main.ts` proto path** — out of scope for this task (covered by a separate task analogous to task 18 for biometric stream). Plan does not claim responsibility, which is correct.

### Positive Notes
- Plan is concise and references the exact reference file (`BciDevicesGrpcController`) without ambiguity.
- All proto/entity field names are spelled out, which prevents mapper drift.
- Type-only imports for entity and proto with alias `NfbCalibrationRecordProto` correctly avoid the name collision.
- Empty-string vs null convention is documented inline, matching the proto comment.
- Both `record` and `list` paths funnel through the single mapper — no duplication.

PLAN_REVIEW_PASS
