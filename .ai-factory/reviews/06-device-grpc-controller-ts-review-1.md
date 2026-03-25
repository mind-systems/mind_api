# Review: device.grpc.controller.ts — iteration 1

## Files reviewed
- `src/device/device.grpc.controller.ts` (new)
- `src/device/device.module.ts` (modified)

## Cross-referenced
- `proto/generated/device.ts` — generated interface and types
- `src/device/device.service.ts` — service being called
- `src/device/dto/device-ping.dto.ts` — DTO type accepted by service
- `src/device/entities/device.entity.ts` — entity written to DB
- `src/grpc/grpc-exception.filter.ts` — exception filter applied
- `src/stats/stats.grpc.controller.ts` — reference pattern

## Checks

| Check | Result |
|-------|--------|
| TypeScript compiles (`tsc --noEmit`) | Pass — no errors |
| Implements `DeviceServiceController` correctly | Pass — `ping()` signature matches |
| `@DeviceServiceControllerMethods()` applied | Pass — registers `GrpcMethod("DeviceService", "ping")` |
| `@UseFilters(GrpcExceptionFilter)` applied | Pass — converts `HttpException` to `RpcException` |
| `PingRequest` structurally compatible with `DevicePingDto` | Pass — all 11 fields match name and type; `model`/`manufacturer` optional in both |
| Return type `{}` matches `PingResponse` | Pass — `PingResponse` is empty interface |
| No auth needed | Correct — HTTP `DeviceController.ping()` is also unauthenticated |
| Module registration | Pass — `DeviceGrpcController` added to `controllers` array, import present |
| No migrations needed | Correct — no schema changes |
| No race conditions | N/A — upsert by `installationId` (unique index), no user-scoped state |

## Notes

- **Validation bypass is expected.** gRPC requests skip `class-validator` (`DevicePingDto` decorators like `@IsInt()`, `@Min(0)` don't run). This is consistent with all other gRPC controllers in the project. Protobuf enforces field types at the wire level (`int32` for screen dimensions, `string` for the rest), so the risk is limited to empty strings which the service handles gracefully.
- **Pattern consistency.** The controller is simpler than `StatsGrpcController` because it omits JWT/session logic — correctly matching the unauthenticated nature of the endpoint.

## Verdict

No bugs, no security issues, no correctness problems found.

REVIEW_PASS
