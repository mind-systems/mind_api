# Code Review: Migrate `activityMap` out of `LiveGateway`

**Plan:** `21-migrate-activitymap-out-of-livegateway.md`
**Risk Level:** Low

## Verification

| Check | Result |
|---|---|
| TypeScript compilation (`tsc --noEmit`) | Pass — zero errors |
| Unit tests (`npx jest src/realtime/`) | Pass — 68 tests, 9 suites, 0 failures |
| No stale `GraceTimerManager` references in `src/` | Confirmed — zero hits |
| No stale `stateStore.activityMap` references in `src/` | Confirmed — `activityMap` only exists as private field in `ActivitySessionStore` |
| `grace-timer.service.ts` + spec deleted | Confirmed via `git status` |
| DI wiring (`RealtimeModule`) | `ActivitySessionStore` in providers + exports, `GraceTimerManager` removed |

## File-by-file

### `activity-session-store.service.ts` (new)

Correctly absorbs both the Map CRUD wrapper and the grace timer logic from `GraceTimerManager`. The `startGraceTimer` → `cancelGraceTimer` → `this.timers.delete` sequence preserves the double-start-cancels-previous semantic. `void onExpiry()` correctly handles the `Promise<void>` return type. Default grace period matches the deleted `GraceTimerManager` (30 000 ms).

### `activity-engine.service.ts`

All ~15 `stateStore.activityMap.*` call sites replaced with `activitySessionStore.*`. `StateStore` fully removed from constructor — correct, since `ActivityEngine` never referenced `socketMap`/`streamMap`/`presenceMap`.

`handleReconnect` and `handleTransportDisconnect` correctly centralise the reconnect/disconnect logic that was duplicated across both transports. Logic matches the old behavior in `LiveGateway.handleConnection` (lines 115-134) and `LiveStreamGrpcController.setup/teardown`.

### `live.gateway.ts`

`GraceTimerManager` removed from constructor. `StateStore` retained (still needed for `socketMap`). `handleConnection` now calls `handleReconnect` unconditionally — negligible overhead since `handleReconnect` returns `null` immediately when no session is pending. `handleDisconnect` simplified from a `.then()` chain to a single `handleTransportDisconnect()` call.

### `live-stream.grpc.controller.ts`

`StateStore` and `GraceTimerManager` both removed from constructor. Setup and teardown blocks simplified to use `handleReconnect` / `handleTransportDisconnect`. Behavior preserved.

### `state-store.ts`

`activityMap` field and `ActivityState` import removed. `socketMap`, `streamMap`, `presenceMap` retained.

### `observability.service.ts`

`ActivitySessionStore` injected alongside `StateStore`. `activityMap.size` replaced with `activitySessionStore.size`.

### `realtime.module.ts`

`ActivitySessionStore` added to providers and exports. `GraceTimerManager` removed.

### `activity-engine.service.spec.ts`

All `stateStore.activityMap.*` references replaced with `activitySessionStore.*`. Real `ActivitySessionStore` instance used with mock `ConfigService`. Constructor call updated. All 16 tests pass.

### `live.gateway.spec.ts`

`GraceTimerManager` mock removed. `handleReconnect` and `handleTransportDisconnect` added to the `makeActivityEngine()` factory. Reconnect and disconnect tests rewritten to assert on the new orchestration methods instead of on internal `activityMap`/`graceTimerManager` calls. All 14 tests pass.

### `grace-timer.service.spec.ts`

Deleted — source file no longer exists.

## Notes

- The "Grace expired" log line from the old `LiveGateway` disconnect handler is no longer emitted. `abandonActivity` itself still logs `Session abandoned: ...` on success, so observability is not lost — just one fewer log line per grace expiry. Consistent with plan's "Logging: minimal" setting.

REVIEW_PASS
