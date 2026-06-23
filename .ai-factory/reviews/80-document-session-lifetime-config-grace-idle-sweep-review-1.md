# Code Review: Document session-lifetime config (grace / idle / sweep)

**Scope:** Documentation-only change to `docs/realtime/configuration.md` (plus plan/metadata artifacts under `.ai-factory/`).
**Risk:** 🟢 Low — no source code changed.

## What changed
- Two rows added to the env-var table: `WS_SESSION_MAX_IDLE_MS` (`600000`) and `WS_SESSION_SWEEP_INTERVAL_MS` (`60000`), placed adjacent to `WS_RECONNECT_GRACE_MS`.
- New `## Keep-alive для телефонных медитаций` section explaining the `hasLiveSubscriber` guard and why grace stays 30 s.

## Verification against code

| Doc claim | Source | Result |
|-----------|--------|--------|
| `WS_SESSION_MAX_IDLE_MS` default `600000` | `session-watchdog.service.ts:32-35` fallback `600_000` | ✅ |
| `WS_SESSION_SWEEP_INTERVAL_MS` default `60000` | `session-watchdog.service.ts:36-39` fallback `60_000` | ✅ |
| Watchdog reaps sessions with status `active`/`disconnected` and `lastActivityAt` older than threshold | `session-watchdog.service.ts:57-63` (`In([ACTIVE, DISCONNECTED])`, `LessThan(threshold)`) | ✅ |
| Session with a live subscriber is skipped (never reaped) | `session-watchdog.service.ts:71-76` (`hasLiveSubscriber(row.userId)` → `continue`) | ✅ |
| Sweep runs every interval, checking unfinished sessions and reaping idle ones | `onApplicationBootstrap` `setInterval(..., sweepIntervalMs)` + `sweep()` | ✅ |
| `WS_RECONNECT_GRACE_MS` default `30000`, marks session `abandoned` | unchanged existing row; consistent with grace path | ✅ |
| Env-var names (`WS_SESSION_MAX_IDLE_MS`) documented, not the `RealtimeConfig` constant keys | doc uses `WS_`-prefixed names | ✅ |

## Findings

### Critical / Correctness
None. Every default and behavioral claim matches the watchdog source exactly.

### Minor / Non-blocking
1. **Editorial framing of grace as "практически не задействован."** The note states the reconnect grace is mostly unused while the stream is alive. This is an accurate characterization of the keep-alive path (a live subscriber bypasses the watchdog, and the grace timer governs the separate transport-disconnect path), but it is interpretive rather than a hard code fact. No correction needed — wording stays descriptive.
2. **`session-lifecycle.md` now linked both inline and in `## See Also`.** Harmless duplication; the inline contextual link is justified. Note the user's global doc style discourages "See Also" sections, but that footer is pre-existing and out of scope for this change.

## Scope / Guard compliance
- No files under `src/` modified — watchdog logic, grace default, and `RealtimeConfig` constants untouched, as required.
- No migration implied or needed.
- Russian language and table style match surrounding doc.

## Conclusion
Accurate, well-scoped, no runtime impact. All documented values and semantics are faithful to the code.

REVIEW_PASS
