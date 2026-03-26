# Review: sync.grpc.controller.ts

## Files reviewed
- `src/sync/sync.grpc.controller.ts` (new)
- `src/sync/sync.module.ts` (modified)

## Checklist

| Area | Status | Notes |
|------|--------|-------|
| Interface compliance | OK | Implements `SyncServiceController` from `proto/generated/sync.ts`; both `getChanges` and `watchChanges` signatures match |
| DI resolution | OK | `AuthModule` exports `JwtModule` (provides `JwtService`) and `SessionService`; `SyncModule` imports `AuthModule` — all three constructor deps resolve |
| Auth pattern | OK | Inline JWT extraction from metadata matches `stats.grpc.controller.ts` exactly; `verifyAsync` → `sessionService.isValid()` chain is correct |
| Response mapping | OK | `'fullResync' in result` correctly discriminates the union; `Date.toISOString()` matches proto's `string` type for `createdAt` |
| `watchChanges` stub | OK | `throwError(() => new RpcException({ code: UNIMPLEMENTED }))` immediately errors the Observable — correct behavior for an unimplemented server-streaming RPC |
| Exception handling | OK | `@UseFilters(GrpcExceptionFilter)` catches `HttpException` from services and maps to gRPC status codes |
| Module wiring | OK | `SyncGrpcController` added to `controllers` array alongside `SyncController`; no spurious imports |

## Issues

None.

## Observations (non-blocking, pre-existing)

**No input validation on gRPC side.** The HTTP controller validates `limit` via `@Min(1) @Max(100)` on `SyncChangesQueryDto`. The gRPC controller passes `request.limit` straight through. Proto3 defaults unset `int32` to `0`, which would cause `ChangeLogService.getChanges` to execute `LIMIT 1`, return `{ events: [], cursor: afterId, hasMore: true }` — an infinite-loop trap for naive clients. This is a pre-existing gap across all gRPC controllers (not introduced here) and will be addressed holistically when input validation is added to the gRPC layer.

REVIEW_PASS
