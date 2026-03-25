# Plan: stats.grpc.controller.ts

## Context
Add a gRPC controller for the Stats service, exposing the `GetStats` RPC. Follows the same pattern established by `users.grpc.controller.ts` and `breath-sessions.grpc.controller.ts` — manual JWT extraction from metadata, delegation to the existing `StatsService`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Controller and wiring

- [x] **Task 1: Create `src/stats/stats.grpc.controller.ts`**
  Files: `src/stats/stats.grpc.controller.ts`
  Create the gRPC controller following the exact pattern from `src/users/users.grpc.controller.ts`:
  - Decorate class with `@Controller()`, `@StatsServiceControllerMethods()`, `@UseFilters(GrpcExceptionFilter)`.
  - Implement `StatsServiceController` interface from `../../proto/generated/stats`.
  - Inject `StatsService`, `JwtService`, `SessionService`.
  - Implement `getStats(request: GetStatsRequest, metadata?: Metadata): Promise<GetStatsResponse>`:
    - Extract JWT from `metadata.get('authorization')`, strip `Bearer ` prefix.
    - Verify token via `jwtService.verifyAsync<JwtPayload>` — throw `RpcException` with `GrpcStatus.UNAUTHENTICATED` on failure.
    - Validate session via `sessionService.isValid(token)` — throw `RpcException` with `GrpcStatus.UNAUTHENTICATED` if revoked.
    - Call `this.statsService.getStats(userId)`.
    - Map the `UserStatsResponseDto` result to `GetStatsResponse`: all fields pass through directly except `lastSessionDate: null` which becomes `undefined` (proto optional field).
  - Include the same `// TODO: uncomment when 1.4 is merged` comments for `GrpcAuthInterceptor` and `@GrpcCurrentUser()` as in the other controllers.

- [x] **Task 2: Register controller in `StatsModule`**
  Files: `src/stats/stats.module.ts`
  Add `StatsGrpcController` to the `controllers` array alongside the existing `StatsController`. The module already imports `AuthModule` (provides `JwtService` and `SessionService`), so no new imports are needed.
