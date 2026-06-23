# Plan: Document session-lifetime config (grace / idle / sweep)

## Context
Document the three session-lifetime env vars (`WS_RECONNECT_GRACE_MS`, `WS_SESSION_MAX_IDLE_MS`, `WS_SESSION_SWEEP_INTERVAL_MS`) in the realtime configuration doc, including the `hasLiveSubscriber` guard that keeps a phone-only meditation alive. Documentation only — no code or behavior change.

## Settings
- Testing: no
- Logging: minimal
- Docs: yes

## Constraints
- **No code/behavior change.** Do not touch `session-watchdog.service.ts`, `activity-session-store.service.ts`, the `RealtimeConfig` constants, or the 30 s grace default.
- The doc `docs/realtime/configuration.md` is written in **Russian** — match the existing language and table style.
- Document the `WS_`-prefixed **env var names**, not the `RealtimeConfig` constant keys (`SESSION_MAX_IDLE_MS` / `SESSION_SWEEP_INTERVAL_MS`).
- Confirmed code defaults: `WS_RECONNECT_GRACE_MS` = `30000`, `WS_SESSION_MAX_IDLE_MS` = `600000`, `WS_SESSION_SWEEP_INTERVAL_MS` = `60000` (`session-watchdog.service.ts:32-39`; `hasLiveSubscriber` guard at `:71`).

## Tasks

### Phase 1: Documentation

- [x] **Task 1: Add the two watchdog env vars to the config table**
  Files: `docs/realtime/configuration.md`
  In the env-var table, add two rows next to the existing `WS_RECONNECT_GRACE_MS` row (keep the table grouped logically — place them adjacent to the reconnect-grace row since all three govern session lifetime):
  - `WS_SESSION_MAX_IDLE_MS` — default `600000` (10 мин) — idle threshold: the watchdog reaps a session whose `lastActivityAt` is older than this, unless it has a live subscriber.
  - `WS_SESSION_SWEEP_INTERVAL_MS` — default `60000` (1 мин) — how often the watchdog sweep runs.
  Write the descriptions in Russian to match the existing rows. Optionally refine the existing `WS_RECONNECT_GRACE_MS` description so the three read as a coherent group, but do not change its `30000` default.

- [x] **Task 2: Document the `hasLiveSubscriber` guard**
  Files: `docs/realtime/configuration.md`
  Below the table, add a short prose note (Russian) explaining the keep-alive guard: a session with an open stream (`activeStreamRegistry.hasLiveSubscriber(userId)`) is never reaped by the watchdog. This is why a phone-only meditation that is kept alive — even with no biometric heartbeat advancing `lastActivityAt` — survives past `WS_SESSION_MAX_IDLE_MS`. Note that grace stays 30 s by design: keep-alive holds the stream connected so the reconnect grace is mostly moot, and no grace value rescues a multi-minute suspension. Link to [Жизненный цикл сессии](session-lifecycle.md) for the underlying state model.

## Verify
- `docs/realtime/configuration.md` lists all three session-lifetime vars (`WS_RECONNECT_GRACE_MS`, `WS_SESSION_MAX_IDLE_MS`, `WS_SESSION_SWEEP_INTERVAL_MS`) with the correct code defaults.
- The `hasLiveSubscriber` keep-alive guard is explained.
- No source files under `src/` were modified.
