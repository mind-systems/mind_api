# Plan: Delete Socket.io server files and remove dependency

## Context
Remove the entire Socket.IO transport layer from the realtime module — gateways, WS-specific guards/middleware/filters, and the `authenticated-socket` interface — then uninstall Socket.IO npm packages. Clean up all resulting dead code (unused event constants, types, config keys). The gRPC stream controllers and supporting services remain intact.

## Settings
- Testing: no
- Logging: minimal
- Docs: no — `docs/socket/` files describe the Socket.IO transport and will become partially or fully obsolete after this removal; cleanup of those docs is deferred to a follow-up task

## Tasks

### Phase 1: Delete Socket.IO source files

- [x] **Task 1: Delete gateway files and their specs**
  Files (delete): `src/realtime/gateways/live.gateway.ts`, `src/realtime/gateways/live.gateway.spec.ts`, `src/realtime/gateways/telemetry.gateway.ts`, `src/realtime/gateways/telemetry.gateway.spec.ts`
  Remove both Socket.IO gateways and their unit tests. After deletion the `src/realtime/gateways/` directory will be empty and should be removed.

- [x] **Task 2: Delete WS middleware, guards, filter, interface, envelope type, and telemetry events**
  Files (delete): `src/realtime/middleware/ws-auth.middleware.ts`, `src/realtime/guards/ws-auth.guard.ts`, `src/realtime/guards/ws-auth.guard.spec.ts`, `src/realtime/guards/ws-payload-size.guard.ts`, `src/realtime/guards/ws-rate-limit.guard.ts`, `src/realtime/guards/ws-rate-limit.guard.spec.ts`, `src/realtime/filters/ws-exception.filter.ts`, `src/realtime/interfaces/authenticated-socket.interface.ts`, `src/realtime/types/ws-envelope.type.ts`, `src/realtime/events/telemetry.events.ts`
  Remove all WebSocket-specific infrastructure plus two dead files: `ws-envelope.type.ts` (zero imports in codebase) and `telemetry.events.ts` (`DATA_STREAM`, `DATA_ACK` only consumed by deleted gateways). After deletion, remove the now-empty directories: `src/realtime/middleware/`, `src/realtime/filters/`, `src/realtime/types/`. The `src/realtime/guards/` directory will also be empty and should be removed. The `src/realtime/interfaces/` directory still contains `activity-state.interface.ts`, `presence-state.interface.ts`, and `session-buffer.interface.ts` — leave it in place.

### Phase 2: Update surviving files that referenced deleted code

- [x] **Task 3: Clean up realtime.module.ts** (depends on Tasks 1-2)
  Files: `src/realtime/realtime.module.ts`
  Remove the five import statements for deleted files (`WsAuthGuard`, `WsAuthMiddleware`, `LiveGateway`, `TelemetryGateway`, `WsRateLimitGuard`) and remove these five tokens from the `providers` array: `WsAuthMiddleware`, `WsAuthGuard`, `WsRateLimitGuard`, `LiveGateway`, `TelemetryGateway`. Everything else in the module (gRPC controllers, services, StateStore, exports) stays unchanged.

- [x] **Task 4: Remove socketMap from StateStore** (depends on Task 2)
  Files: `src/realtime/state-store.ts`
  Remove the `AuthenticatedSocket` import and delete the `socketMap` field. The `socketMap` was only used by `LiveGateway` (deleted) and `ObservabilityService` (updated in next task). The `streamMap` and `presenceMap` fields remain — they are used by gRPC controllers.

- [x] **Task 5: Update ObservabilityService** (depends on Task 4)
  Files: `src/realtime/services/observability.service.ts`
  Remove the `connectedSockets` variable and its reference to `stateStore.socketMap.size` from `logMetrics()`. Update the log line to only report `activeSessions` and `connectedStreams`.

- [x] **Task 6: Remove IoAdapter from main.ts** (depends on Task 2)
  Files: `src/main.ts`
  Remove the `import { IoAdapter } from '@nestjs/platform-socket.io';` statement (line 12) and the `app.useWebSocketAdapter(new IoAdapter(app));` call (line 56). No replacement adapter is needed — the gRPC transport is configured separately via `connectMicroservice`.

- [x] **Task 7: Clean up dead exports in live.events.ts** (depends on Task 1)
  Files: `src/realtime/events/live.events.ts`
  After gateway deletion, only `LIVE_SESSION_PAUSED` and `LIVE_SESSION_UNPAUSED` are still consumed (by `activity-engine.service.ts`). Remove the 10 dead exports: `ACTIVITY_START`, `ACTIVITY_END`, `ACTIVITY_STOP`, `ACTIVITY_PAUSE`, `ACTIVITY_RESUME`, `PRESENCE_BACKGROUND`, `PRESENCE_FOREGROUND`, `SESSION_STATE`, `SESSION_ERROR`, `WS_EXCEPTION`. The file should contain only the two surviving exports.

- [x] **Task 8: Remove dead export RATE_LIMIT_MAX_EVENTS from realtime-config.ts** (depends on Task 2)
  Files: `src/realtime/constants/realtime-config.ts`
  Remove the `RATE_LIMIT_MAX_EVENTS: 'WS_RATE_LIMIT_MAX_EVENTS'` entry from the `RealtimeConfig` object. After `WsRateLimitGuard` is deleted, this key has zero consumers. The remaining keys (`RATE_LIMIT_ACTIVITY_START_PER_MIN`, `RATE_LIMIT_WINDOW_MS`, `STREAM_MAX_BUFFER_BYTES`, `STREAM_MAX_SESSIONS`, `BACKPRESSURE_SAMPLES_PER_SEC`, `STREAM_FLUSH_INTERVAL_MS`) are still used by gRPC controllers and services.

### Phase 3: Uninstall npm packages

- [x] **Task 9: Uninstall Socket.IO dependencies** (depends on Task 6)
  Files: `package.json`, `package-lock.json`
  Run `npm uninstall socket.io @nestjs/platform-socket.io @nestjs/websockets`. This removes all three packages from `dependencies` in `package.json` and regenerates the lockfile. Verify with `npm ls socket.io` that no residual references remain.

## Commit Plan
- **Commit 1** (after tasks 1-9): "Delete Socket.IO server files and remove dependency"
