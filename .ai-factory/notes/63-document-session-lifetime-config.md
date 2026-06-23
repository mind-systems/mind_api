# Document session-lifetime config (grace / idle / sweep)

**Date:** 2026-06-22
**Source:** conversation context

## Key Findings

- The env vars **`WS_SESSION_MAX_IDLE_MS`** (600_000) and **`WS_SESSION_SWEEP_INTERVAL_MS`** (60_000) are **undocumented** in `docs/realtime/configuration.md`; only `WS_RECONNECT_GRACE_MS` is. They govern when a session is reaped, so they belong in the config doc. (NB: `SESSION_MAX_IDLE_MS`/`SESSION_SWEEP_INTERVAL_MS` are only the `RealtimeConfig` constant **keys** — `realtime-config.ts:12-13` — that map to the `WS_`-prefixed env vars; document the env var names, not the keys.)
- **Decision: keep the reconnect grace at 30 s** (no value change). The reconnect grace is mostly moot once mobile keep-alive (mind_mobile notes 138/139) holds the stream connected, and raising it cannot rescue a multi-minute suspension anyway (a 28-min gap dies under any grace). The only case a larger grace would help is a real 30–120 s network drop while the app is alive — a narrow, general-networking concern not worth the trade-off (longer-lived zombie sessions). So this task is documentation-only.

## Details

### Current state
- `src/realtime/services/activity-session-store.service.ts:5` — `const DEFAULT_GRACE_MS = 30_000;` overridable by `WS_RECONNECT_GRACE_MS`. **Unchanged.**
- `src/realtime/services/session-watchdog.service.ts:32-39` — env `WS_SESSION_MAX_IDLE_MS` default `600_000` (via `RealtimeConfig.SESSION_MAX_IDLE_MS`), env `WS_SESSION_SWEEP_INTERVAL_MS` default `60_000` (via `RealtimeConfig.SESSION_SWEEP_INTERVAL_MS`); sweep skips users with `activeStreamRegistry.hasLiveSubscriber(userId)` (`:71`).
- `docs/realtime/configuration.md` documents `WS_RECONNECT_GRACE_MS` (30 s) only; the two watchdog env vars are code-only (defined as keys in `realtime-config.ts:12-13`).

### Change (documentation only)
- Document all three session-lifetime vars in `docs/realtime/configuration.md` with defaults + semantics:
  - `WS_RECONNECT_GRACE_MS` — `30000` (30 s) — reconnect window before a DISCONNECTED session is abandoned.
  - `WS_SESSION_MAX_IDLE_MS` — `600000` (10 min) — idle threshold after which the watchdog reaps a session (unless it has a live subscriber).
  - `WS_SESSION_SWEEP_INTERVAL_MS` — `60000` (1 min) — how often the watchdog sweeps.
- Note the `hasLiveSubscriber` guard: a session with an open stream is never reaped, which is why a kept-alive phone-only meditation (no biometric heartbeat to advance `lastActivityAt`) survives.

### Guards
- **No code/behavior change** — grace stays 30 s; do not touch the watchdog logic or the `hasLiveSubscriber` guard.
- Docs only; no test changes.

### Verify
- `docs/realtime/configuration.md` lists all three vars with the correct code defaults.

## Open Questions
- None. Decided: **no** client heartbeat for silent meditations — the `hasLiveSubscriber` guard (an open stream is never reaped) already covers a kept-alive meditation, so no extra mechanism is added.
