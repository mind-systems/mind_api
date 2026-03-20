# Plan: Replace Magic Strings in Realtime Module

## Context
Replace all remaining raw string literals in the six realtime-module files with the constants and enums already defined in Phase 1 of `08-magic-strings-cleanup`. No new constant files need to be created — only imports and substitutions.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1 — Replace in services

- [x] **Task 1: activity-engine.service.ts — replace all magic strings**
  Files: `src/realtime/services/activity-engine.service.ts`
  Import `SessionEvents` from `../events/session.events`, `StreamDataType` and `StreamSessionEvent` from `../constants/stream-data-types`, `WsErrorCode` from `../constants/ws-error-codes`. Replace:
  - `emit('session.completed')` / `'session.abandoned'` / `'session.interrupted'` → `SessionEvents.COMPLETED` / `.ABANDONED` / `.INTERRUPTED`
  - `dataType: 'session_event'` (6 occurrences) → `StreamDataType.SESSION_EVENT`
  - `event: 'session_started'` / `'session_ended'` / `'session_abandoned'` / `'session_interrupted'` / `'paused'` / `'resumed'` → corresponding `StreamSessionEvent.*`
  - `new Error('no_active_session')` (2 occurrences) → `WsErrorCode.NO_ACTIVE_SESSION`
  - `new Error('already_paused')` → `WsErrorCode.ALREADY_PAUSED`
  - `new Error('not_paused')` → `WsErrorCode.NOT_PAUSED`

- [x] **Task 2: stream-engine.service.ts — @OnEvent decorators + config keys** (independent of Task 1)
  Files: `src/realtime/services/stream-engine.service.ts`
  Import `SessionEvents` from `../events/session.events` and `RealtimeConfig` from `../constants/realtime-config`. Replace:
  - `@OnEvent('session.completed')` / `'session.abandoned'` / `'session.interrupted'` → `SessionEvents.*`
  - `configService.get('WS_STREAM_MAX_BUFFER_BYTES')` → `RealtimeConfig.STREAM_MAX_BUFFER_BYTES`
  - `configService.get('WS_STREAM_MAX_SESSIONS')` → `RealtimeConfig.STREAM_MAX_SESSIONS`
  - `configService.get('WS_BACKPRESSURE_SAMPLES_PER_SEC')` → `RealtimeConfig.BACKPRESSURE_SAMPLES_PER_SEC`
  - `configService.get('WS_STREAM_FLUSH_INTERVAL_MS')` → `RealtimeConfig.STREAM_FLUSH_INTERVAL_MS`

### Phase 2 — Replace in gateways

- [x] **Task 3: live.gateway.ts — SessionStatus enum + error codes + config keys** (independent of Tasks 1-2)
  Files: `src/realtime/gateways/live.gateway.ts`
  Import `SessionStatus` from `../enums/session-status.enum`, `WsErrorCode` from `../constants/ws-error-codes`, `RealtimeConfig` from `../constants/realtime-config`. Replace:
  - `status: 'active'` / `'completed'` / `'interrupted'` / `'resumed'` → `SessionStatus.ACTIVE` / `.COMPLETED` / `.INTERRUPTED` / `.RESUMED`
  - `'RATE_LIMIT_EXCEEDED'` → `WsErrorCode.RATE_LIMIT_EXCEEDED`
  - `'no_active_session'` (2 occurrences) → `WsErrorCode.NO_ACTIVE_SESSION`
  - `configService.get('WS_RATE_LIMIT_ACTIVITY_START_PER_MIN')` → `RealtimeConfig.RATE_LIMIT_ACTIVITY_START_PER_MIN`
  - `configService.get('WS_RATE_LIMIT_WINDOW_MS')` → `RealtimeConfig.RATE_LIMIT_WINDOW_MS`

- [x] **Task 4: telemetry.gateway.ts — error codes + data type check** (independent of Tasks 1-3)
  Files: `src/realtime/gateways/telemetry.gateway.ts`
  Import `WsErrorCode` from `../constants/ws-error-codes` and `StreamDataType` from `../constants/stream-data-types`. Replace:
  - `'NO_SESSION'` → `WsErrorCode.NO_SESSION`
  - `'SESSION_MISMATCH'` → `WsErrorCode.SESSION_MISMATCH`
  - `dataType === 'breath_phase'` → `StreamDataType.BREATH_PHASE`
  - `'session_paused'` → `WsErrorCode.SESSION_PAUSED`

### Phase 3 — Replace in guard and filter

- [x] **Task 5: ws-rate-limit.guard.ts + ws-exception.filter.ts** (independent of Tasks 1-4)
  Files: `src/realtime/guards/ws-rate-limit.guard.ts`, `src/realtime/filters/ws-exception.filter.ts`, `src/realtime/events/live.events.ts`
  **Guard:** import `RealtimeConfig` from `../constants/realtime-config` and `WsErrorCode` from `../constants/ws-error-codes`. Replace:
  - `configService.get('WS_RATE_LIMIT_MAX_EVENTS')` → `RealtimeConfig.RATE_LIMIT_MAX_EVENTS`
  - `configService.get('WS_RATE_LIMIT_WINDOW_MS')` → `RealtimeConfig.RATE_LIMIT_WINDOW_MS`
  - `'RATE_LIMIT_EXCEEDED'` → `WsErrorCode.RATE_LIMIT_EXCEEDED`
  **Filter:** add `export const WS_EXCEPTION = 'exception';` to `live.events.ts`, then import and use it in the filter's `client.emit('exception', ...)` call.
