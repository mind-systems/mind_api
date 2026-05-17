# Plan Review: Replace `metadata?: Metadata` with `@GrpcCurrentUser() user: JwtPayload | null` in `trackActivity`

**Plan file:** `.ai-factory/plans/62-replace-metadata-metadata-with-grpccurrentuser-user-jwtpayload-null-in-trackactivity.md`
**Scope:** Pure refactor of `src/realtime/module-state.grpc.controller.ts`.
**Risk Level:** 🟢 Low

## Context Gates

- **ARCHITECTURE.md** — No boundary/dependency impact: change is confined to a single controller inside `RealtimeModule`. PASS.
- **RULES.md** — The plan explicitly cites and complies with the `@Payload()` + `@GrpcCurrentUser()` rule (line 22 of the plan). PASS.
- **ROADMAP.md** — Not checked for explicit milestone linkage; this is a maintenance refactor that prepares for the test plan in `notes/12-module-state-grpc-controller-test-plan.md`. WARN (non-blocking): plan does not reference a roadmap milestone but its purpose is justified by the linked test plan.

## Verification against the codebase

Cross-checked the plan against the current files:

1. **Current state of `src/realtime/module-state.grpc.controller.ts`** matches what the plan assumes:
   - Line 5 imports `Metadata` and `status as GrpcStatus` from `@grpc/grpc-js`.
   - Line 22 imports `GRPC_USER_KEY` from `../grpc/grpc-auth.constants`.
   - Line 26 imports `JwtPayload`.
   - Line 64 has the exact `trackActivity(request: Observable<StateRequest>, metadata?: Metadata)` signature.
   - Lines 66–68 contain the `(metadata as any)[GRPC_USER_KEY]` extraction that will be replaced.
   - Line 70 has the `if (!user)` UNAUTHENTICATED guard, which the plan correctly retains.

2. **Reference pattern in `src/realtime/sync-stream.grpc.controller.ts`** matches the plan's target: it imports `Payload` from `@nestjs/microservices` and `GrpcCurrentUser` from `../grpc/decorators/grpc-current-user.decorator`, uses `@Payload() request: ..., @GrpcCurrentUser() user: JwtPayload | null`, and does NOT implement a generated controller interface — so the fallback proposed in Task 1 is real and proven.

3. **`@GrpcCurrentUser()` decorator** (`src/grpc/decorators/grpc-current-user.decorator.ts`) reads `metadata[GRPC_USER_KEY]`. The `GrpcAuthInterceptor` (`src/grpc/grpc-auth.interceptor.ts`) attaches the user there before the handler runs — confirmed for bidi-streaming as well (interceptor runs once per RPC call regardless of streaming kind). The plan's claim in Task 3 ("`GrpcAuthInterceptor` continues to attach the user onto `Metadata[GRPC_USER_KEY]`") is accurate.

4. **`ModuleStateServiceController` interface** (in `proto/generated/module_state.ts:511-513`) declares `trackActivity(request: Observable<StateRequest>): Observable<StateResponse>`. Today the controller satisfies it because `metadata?` is optional. After the refactor the second parameter (`user: JwtPayload | null`) becomes required, so `implements ModuleStateServiceController` will fail. The plan anticipates this and proposes the correct fallback (drop the `implements` clause). The class decorator `@ModuleStateServiceControllerMethods()` does not depend on the `implements` clause — it iterates a hard-coded `grpcStreamMethods` list and applies `GrpcStreamMethod("ModuleStateService", "trackActivity")` at runtime regardless (`module_state.ts:515-528`). The plan's reasoning here is correct.

5. **`@Payload()` on bidi-streaming methods** — NestJS resolves `@Payload()` to the call's `data` argument, which for `@GrpcStreamMethod` is the `Observable<StateRequest>`. The plan applies the RULES.md guidance correctly.

6. **No other callers / no other tests touch `trackActivity` today** (`grep` for `trackActivity` shows only the controller and module wiring). No test fixtures need updating; the linked unit-test plan (`notes/12`) has not been implemented yet, so there's nothing to break.

## Critical Issues

None.

## Suggestions (non-blocking)

- **Prefer dropping `implements ModuleStateServiceController` directly** rather than leaving it as a conditional fallback. The generated interface signature (`trackActivity(request)`) cannot accept the new required `user` parameter, so the rebuild WILL fail with `implements` in place. Mirroring `SyncStreamGrpcController` (which never implemented its generated interface) keeps both gRPC controllers stylistically consistent. Treating the fallback as the primary action removes a step from the loop.
- **Type narrowing opportunity (optional, out of scope):** since `GrpcAuthInterceptor` always throws when no token is present and `trackActivity` is required-auth (no `@GrpcOptionalAuth()`), `user` will never actually be `null` at runtime. Keeping `JwtPayload | null` matches the sync controller for consistency, which the plan correctly chooses; just noting that a future cleanup could introduce a non-null variant decorator for required-auth methods to eliminate the dead guard. No action needed in this plan.
- **Logging:** `Settings: Logging: minimal` is honored — no new log lines are introduced. Good.

## Positive Notes

- Plan is mechanical, narrowly scoped, and explicitly references the project's RULES.md `@Payload()` requirement.
- Imports to remove (`Metadata`, `GRPC_USER_KEY`) and to keep (`JwtPayload`, `status as GrpcStatus`) are enumerated precisely.
- Task 3's verification step (`npm run build`) is the right validation for a typing-only refactor; the plan correctly avoids over-spec'ing a runtime smoke test.
- The plan correctly identifies and pre-empts the `implements` clause conflict before it surfaces in the build.

PLAN_REVIEW_PASS
