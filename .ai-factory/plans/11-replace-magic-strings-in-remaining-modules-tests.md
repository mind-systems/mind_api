# Plan: Replace Magic Strings in Remaining Modules & Tests

## Context
Final phase of the magic-strings cleanup (plan 08, Phases 3–4). Replaces raw event-name strings in `stats.worker.ts` and raw status/error-code strings in all test files that now have corresponding constants. The `breath-sessions.service.ts` changelog calls are already migrated — no production changes needed there.

## Settings
- Testing: no (updating existing tests only — no new test logic)
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Replace in production module

- [x] **Task 1: stats.worker.ts — replace @OnEvent raw strings with SessionEvents constants**
  Files: `src/stats/stats.worker.ts`
  Import `SessionEvents` from `src/realtime/events/session.events.ts`.
  Replace the three `@OnEvent` decorator arguments:
  - `'session.completed'` → `SessionEvents.COMPLETED` (line 12)
  - `'session.abandoned'` → `SessionEvents.ABANDONED` (line 29)
  - `'session.interrupted'` → `SessionEvents.INTERRUPTED` (line 46)

### Phase 2: Replace in test files

- [x] **Task 2: activity-engine.service.spec.ts — replace raw event strings with SessionEvents** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.spec.ts`
  Import `SessionEvents` from `../events/session.events`.
  Replace:
  - `'session.completed'` → `SessionEvents.COMPLETED` (line 101)
  - `'session.abandoned'` → `SessionEvents.ABANDONED` (line 172)

- [x] **Task 3: live.gateway.spec.ts — replace raw status strings with SessionStatus and error codes with WsErrorCode** (depends on Task 1)
  Files: `src/realtime/gateways/live.gateway.spec.ts`
  `SessionStatus` is already imported. Add import for `WsErrorCode` from `../constants/ws-error-codes`.
  Replace status strings in `SESSION_STATE` emit assertions:
  - `status: 'active'` → `status: SessionStatus.ACTIVE` (lines 239, 263)
  - `status: 'completed'` → `status: SessionStatus.COMPLETED` (line 282)
  - `status: 'resumed'` → `status: SessionStatus.RESUMED` (line 334)
  Replace error code:
  - `code: 'RATE_LIMIT_EXCEEDED'` → `code: WsErrorCode.RATE_LIMIT_EXCEEDED` (line 205)

- [x] **Task 4: telemetry.gateway.spec.ts — replace raw error codes with WsErrorCode** (depends on Task 1)
  Files: `src/realtime/gateways/telemetry.gateway.spec.ts`
  Import `WsErrorCode` from `../constants/ws-error-codes`.
  Replace:
  - `code: 'NO_SESSION'` → `code: WsErrorCode.NO_SESSION` (line 162)
  - `code: 'SESSION_MISMATCH'` → `code: WsErrorCode.SESSION_MISMATCH` (line 183)

- [x] **Task 5: ws-rate-limit.guard.spec.ts — replace raw error code with WsErrorCode** (depends on Task 1)
  Files: `src/realtime/guards/ws-rate-limit.guard.spec.ts`
  Import `WsErrorCode` from `../constants/ws-error-codes`.
  Replace:
  - `'RATE_LIMIT_EXCEEDED'` → `WsErrorCode.RATE_LIMIT_EXCEEDED` (line 47)

- [x] **Task 6: stream-engine.service.spec.ts — replace raw config keys with RealtimeConfig** (depends on Task 1)
  Files: `src/realtime/services/stream-engine.service.spec.ts`
  Import `RealtimeConfig` from `../constants/realtime-config`.
  In `makeConfig()` defaults object (lines 19–22), replace the raw key strings with computed property names:
  - `WS_STREAM_MAX_BUFFER_BYTES` → `[RealtimeConfig.STREAM_MAX_BUFFER_BYTES]`
  - `WS_STREAM_MAX_SESSIONS` → `[RealtimeConfig.STREAM_MAX_SESSIONS]`
  - `WS_BACKPRESSURE_SAMPLES_PER_SEC` → `[RealtimeConfig.BACKPRESSURE_SAMPLES_PER_SEC]`
