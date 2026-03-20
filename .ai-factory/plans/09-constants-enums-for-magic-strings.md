# Plan: Constants & Enums for Magic Strings

## Context
Introduce dedicated constant objects and enums for all magic strings used across the realtime, changelog, and breath-sessions modules. This is the foundation step — creating the constants only, without replacing usages yet.

## Settings
- Testing: no
- Logging: no
- Docs: no

## Tasks

### Phase 1: Realtime events & session status

- [x] **Task 1: Create SessionEvents const and add RESUMED to SessionStatus**
  Files: `src/realtime/events/session.events.ts` (new), `src/realtime/enums/session-status.enum.ts`
  Create `src/realtime/events/session.events.ts` exporting a `SessionEvents` const object with keys `COMPLETED`, `ABANDONED`, `INTERRUPTED` mapped to `'session.completed'`, `'session.abandoned'`, `'session.interrupted'` respectively. Use `as const` for literal types.
  In `session-status.enum.ts`, add `RESUMED = 'resumed'` to the existing `SessionStatus` enum (currently has `active`, `disconnected`, `completed`, `abandoned`, `interrupted`).

- [x] **Task 2: Create ChangeEntity and ChangeAction enums** (independent of Task 1)
  Files: `src/changelog/changelog.enums.ts` (new), `src/changelog/changelog.events.ts`, `src/changelog/changelog.service.ts`
  Create `src/changelog/changelog.enums.ts` with two enums:
  - `ChangeEntity` with `BREATH_SESSION = 'breath_session'`
  - `ChangeAction` with `CREATED = 'created'`, `UPDATED = 'updated'`, `DELETED = 'deleted'`

  Then type-tighten `ChangeEventPayload` in `changelog.events.ts` — change `entity: string` to `entity: ChangeEntity` and `action: string` to `action: ChangeAction`. Also update the `log()` and `logForRecipients()` signatures in `changelog.service.ts` to accept `ChangeEntity` and `ChangeAction` instead of plain strings. Follow the existing pattern in `changelog.events.ts` for imports.

- [x] **Task 3: Create WsErrorCode constants** (independent of Tasks 1–2)
  Files: `src/realtime/constants/ws-error-codes.ts` (new)
  Create `src/realtime/constants/` directory and add `ws-error-codes.ts` exporting a `WsErrorCode` const object (`as const`) with keys:
  - `RATE_LIMIT_EXCEEDED` → `'RATE_LIMIT_EXCEEDED'` (used in ws-rate-limit.guard, live.gateway)
  - `NO_SESSION` → `'NO_SESSION'` (used in telemetry.gateway)
  - `SESSION_MISMATCH` → `'SESSION_MISMATCH'` (used in telemetry.gateway)
  - `NO_ACTIVE_SESSION` → `'no_active_session'` (thrown in activity-engine.service, caught in live.gateway)
  - `ALREADY_PAUSED` → `'already_paused'` (thrown in activity-engine.service)
  - `NOT_PAUSED` → `'not_paused'` (thrown in activity-engine.service)
  - `SESSION_PAUSED` → `'session_paused'` (used in telemetry.gateway)

- [x] **Task 4: Create StreamDataType and StreamSessionEvent constants** (independent of Tasks 1–3)
  Files: `src/realtime/constants/stream-data-types.ts` (new)
  Create `src/realtime/constants/stream-data-types.ts` exporting two `as const` objects:
  - `StreamDataType` with `SESSION_EVENT = 'session_event'` and `BREATH_PHASE = 'breath_phase'`
  - `StreamSessionEvent` with `STARTED = 'session_started'`, `ENDED = 'session_ended'`, `ABANDONED = 'session_abandoned'`, `INTERRUPTED = 'session_interrupted'`, `PAUSED = 'paused'`, `RESUMED = 'resumed'`

- [x] **Task 5: Create RealtimeConfig constants and local suggestions threshold** (independent of Tasks 1–4)
  Files: `src/realtime/constants/realtime-config.ts` (new), `src/breath-sessions/breath-sessions.service.ts`
  Create `src/realtime/constants/realtime-config.ts` exporting a `RealtimeConfig` const object (`as const`) mapping semantic keys to environment variable names:
  - `RATE_LIMIT_ACTIVITY_START_PER_MIN` → `'WS_RATE_LIMIT_ACTIVITY_START_PER_MIN'`
  - `RATE_LIMIT_MAX_EVENTS` → `'WS_RATE_LIMIT_MAX_EVENTS'`
  - `RATE_LIMIT_WINDOW_MS` → `'WS_RATE_LIMIT_WINDOW_MS'`
  - `STREAM_MAX_BUFFER_BYTES` → `'WS_STREAM_MAX_BUFFER_BYTES'`
  - `STREAM_MAX_SESSIONS` → `'WS_STREAM_MAX_SESSIONS'`
  - `BACKPRESSURE_SAMPLES_PER_SEC` → `'WS_BACKPRESSURE_SAMPLES_PER_SEC'`
  - `STREAM_FLUSH_INTERVAL_MS` → `'WS_STREAM_FLUSH_INTERVAL_MS'`

  In `breath-sessions.service.ts`, extract the inline `'SUGGESTIONS_COMPLEXITY_THRESHOLD'` string (used once in `this.configService.get(...)`) into a local `const SUGGESTIONS_COMPLEXITY_THRESHOLD = 'SUGGESTIONS_COMPLEXITY_THRESHOLD'` at the top of the file, before the class declaration.
