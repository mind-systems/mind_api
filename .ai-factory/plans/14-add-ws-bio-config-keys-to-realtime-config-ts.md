# Plan: Add `WS_BIO_*` config keys to `realtime-config.ts`

## Context
Extend the `RealtimeConfig` constants map with four new `WS_BIO_*` env-var keys so the upcoming biometric stream engine can consume them. The file must compile standalone — no other code depends on these keys yet.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Add config keys

- [x] **Task 1: Append four `BIO_*` entries to `RealtimeConfig`**
  Files: `src/realtime/constants/realtime-config.ts`
  Add four new entries to the `RealtimeConfig` object literal, following the existing key-to-env-var pattern (constant key in `SCREAMING_SNAKE_CASE`, value is the env-var name string prefixed with `WS_`). Append them after the existing `STREAM_FLUSH_INTERVAL_MS` entry:
  - `BIO_STREAM_MAX_BUFFER_BYTES: 'WS_BIO_STREAM_MAX_BUFFER_BYTES'` (default 1 MB / `1048576` — documented for the consumer, not declared here)
  - `BIO_STREAM_MAX_SESSIONS: 'WS_BIO_STREAM_MAX_SESSIONS'` (default 1000)
  - `BIO_BACKPRESSURE_SAMPLES_PER_SEC: 'WS_BIO_BACKPRESSURE_SAMPLES_PER_SEC'` (default 50)
  - `BIO_STREAM_FLUSH_INTERVAL_MS: 'WS_BIO_STREAM_FLUSH_INTERVAL_MS'` (default 5000)
  Preserve the `as const` assertion. Defaults will be applied later by the engine code via `ConfigService.get(..., <default>)` — do NOT add default values inside this file. Verify `npm run build` succeeds before stopping.

<!-- orchestrator-sessions
planner: 73596509-b336-41b0-87fa-fa3d841078fa
elapsed: 213
implementer: d2996b46-7106-42ce-bd2f-7718d3e0a252
-->
