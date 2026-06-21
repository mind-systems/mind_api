# Client-sourced activity start/end timestamps

**Date:** 2026-06-21
**Source:** conversation context (cross-project breath-timeline diagnosis)

## Key Findings

- **Measured bug.** For breath session `b3d36c59-…` (run ~11:00:00Z): client (`mind_mobile`) finished and called `end` at 11:02:13Z, but the server stamped `endedAt` at 11:02:18Z (`Session ended … durationMs=138504`) — **~5 s late**. The web bounds the last phase bar by `endedAt`, so it stretched to ~7 s while every other exhale is 3 s; client-stamped biometrics correctly stop at the true end, so they look cut off ~5 s early. One root cause.
- **Why.** Phase markers and biometric samples already ride the **client** clock (mobile sends `timestamp = originWallClock + offsetMs`). But the activity lifecycle is **server**-clocked: `activity-engine.service.ts` sets `startedAt = new Date()` (line 38/44) on start receipt and `endedAt = new Date()` (line 102) on end receipt. `ActivityEndCmd {}` is empty — it carries no client time. So the `end` command's delivery/processing latency leaks straight into `endedAt`. This is the asymmetry to remove.
- **Decision (continues the prior client-as-source-of-truth choice — see `mind_mobile` notes 121/124, the breath offset axis).** Extend client-sourced time to the lifecycle: accept an optional client timestamp on **both** `ActivityStartCmd` and `ActivityEndCmd`, and use it for `startedAt`/`endedAt`, falling back to server `now()` when absent. No new trust assumption — the sample streams already trust the device wall clock; this just makes lifecycle consistent with them.
- **Backward compatible / independently shippable.** Optional proto fields; until a client sends them the server behaves exactly as today (`now()`). So this lands first (proto is owned here) and is a safe no-op until `mind_mobile` activates it.

## Details

### Proto (`proto/module_state.proto`) — owned here

- `ActivityStartCmd`: add `optional int64 client_timestamp_ms = 4;` (field 3 is `reserved`).
- `ActivityEndCmd`: add `optional int64 client_timestamp_ms = 1;` (currently `{}`).
- Regenerate stubs: `npm run proto:gen`. Do **not** hand-edit `proto/generated/`.
- After this lands, `mind_mobile` copies the updated proto and regenerates (downstream task — out of scope here).

### Controller (`src/realtime/module-state.grpc.controller.ts`)

- `handleActivityStart` (~line 286): pass `msg.activityStart.clientTimestampMs` into `activityEngine.startActivity(userId, { …, clientTimestampMs })`.
- End path (~line 305): change `activityEngine.endActivity(userId)` → `endActivity(userId, msg.activityEnd.clientTimestampMs)`.

### Engine (`src/realtime/services/activity-engine.service.ts`)

- `startActivity(userId, { …, clientTimestampMs? })`: **split the shared `const now`** (today `startedAt` and `lastActivityAt` both read the single `now` at lines 38/44-45). Set `startedAt = coerceClientTs(clientTimestampMs) ?? now` but keep **`lastActivityAt = now` (server clock, always)** — never the client value. Same for the in-memory `ActivityState` mirror: `state.startedAt = saved.startedAt` (may be client), `state.lastActivityAt` stays server `now`.
- `endActivity(userId, clientTimestampMs?)`: `endedAt = coerceClientTs(clientTimestampMs) ?? now`. Does not touch `lastActivityAt` (session transitions to `COMPLETED`, which the watchdog ignores) — leave it.
- `coerceClientTs` helper: ts-proto int64 arrives as a `Long`/string — coerce with `Number(...)` (see the Long pitfall in Phase 32 / `bio sample timestamp stored as Long`). Treat `0`, `undefined`, `NaN`, or non-finite as absent → fall back to `now`.
- **Sanity rule (single, fixed):** if the coerced client `endedAt` is absent/invalid **or** lands before `startedAt`, use `now()`. No other branch (do not clamp to `startedAt`, do not keep a negative value). Keep the existing `durationMs = endedAt - startedAt` log so the chosen value is visible.

### Watchdog safety — `lastActivityAt` MUST stay server-clocked (load-bearing)

This is the one trap that turns a benign change into a session killer, verified against the code:

- `SessionWatchdogService.sweep` (`src/realtime/services/session-watchdog.service.ts:56-91`) reaps rows where `status ∈ {ACTIVE, DISCONNECTED} AND lastActivityAt < now − WS_SESSION_MAX_IDLE_MS (600s) AND` the user has **no live subscriber**. It keys on **`lastActivityAt`**, never `startedAt`/`endedAt`.
- The `hasLiveSubscriber` guard (Phase 42 M1) only protects a **connected** client: the `trackActivity` control stream registers in `ActiveStreamRegistry` (`module-state.grpc.controller.ts:102`) and deregisters on disconnect (`:162`). So while connected, the session is skipped regardless of `lastActivityAt` — but on transport drop the session goes `DISCONNECTED` with **no** subscriber, protected only by the 30 s reconnect-grace timer.
- **The trap:** in `startActivity`, `startedAt` and `lastActivityAt` share one `const now`. If the client clock is behind by > `WS_SESSION_MAX_IDLE_MS` (600 s) and that value leaks into `lastActivityAt`, a freshly-`DISCONNECTED` session looks stale on the **very next sweep (≤60 s)** and is reaped **inside the grace window** — breaking the note-54 invariant `WS_SESSION_MAX_IDLE_MS (600s) > WS_RECONNECT_GRACE_MS (30s)` that guarantees a reconnecting client is never eaten. So `lastActivityAt` must remain server `now()` (see the engine split above).
- Also keep the `SESSION_EVENT` stream markers (`streamEngine.push(…, { timestamp: Date.now() })`, lines 60/106) on **server** `Date.now()` — they are the server wall-clock lifecycle/pause journal (note 49), not the client offset axis. Do not feed `client_timestamp_ms` into them.

### Downstream stats consequence — `totalDurationSeconds` (accepted property)

Making `startedAt`/`endedAt` client-sourced moves session **duration** onto the client clock too, and `durationMs = endedAt − startedAt` feeds `StatsService.finalise` → `totalDurationSeconds`. The `endedAt ≥ startedAt` sanity rule is the only engine-level bound. `currentStreak`/`lastSessionDate` key off server `todayUtc()` and are not forgeable; the affected field is solely the user's own `totalDurationSeconds`.

**No server-side maximum on session duration.** Client-sourced `startedAt`/`endedAt` fully determine `durationMs`, consistent with trusting the device wall clock for biometrics and phase markers. `StatsService.finalise` applies only the `WS_MIN_SESSION_DURATION_S` minimum filter — there is no upper cap. This is the accepted property as of note 59 (supersedes the cap decision in the original note).

### Why this fixes both symptoms

`endedAt` becomes the client's true completion instant (same clock as `offsetMs` and biometric timestamps). The web's last bar = `endedAt − lastPhaseOffset` ≈ the nominal phase length; biometrics no longer appear to stop early because the timeline no longer overshoots them. `mind_web` needs no change.

### Guards

- Optional fields only — never make them required; absent → `now()` (today's behavior).
- Do not hand-edit generated proto; do not change `ActivityPauseCmd`/`ActivityResumeCmd`/`ActivityStopCmd` (pause/resume already ride the client offset axis via the instruction stream; stop is terminal).
- `lastActivityAt` is **never** client-sourced — only `startedAt`/`endedAt` are. This is not optional hardening; it preserves the watchdog grace-window invariant (see "Watchdog safety" above).
- Update `activity-engine.service.spec.ts` expectations: with a client ts → `startedAt`/`endedAt` equal it; without → `expect.any(Date)` as today. **Add a case** asserting `lastActivityAt` stays server-clocked even when a (past) `clientTimestampMs` is supplied to `startActivity` — i.e. `lastActivityAt !== startedAt` and `lastActivityAt ≈ now`.

### Verification

1. A client sending `client_timestamp_ms` on end → `endedAt` equals it (not receipt time); `Session ended … durationMs` matches the client's session duration.
2. A client omitting it (old build) → `endedAt = now()`, unchanged.
3. Negative/garbage client ts → falls back to `now()`, `durationMs ≥ 0`.

## Decisions (settled — do not re-open)

- **Both `startedAt` and `endedAt` are client-sourced** when the client provides the field. The server honors both — do not ignore the start field, do not make it "end-only". This puts the whole axis (start, phase offsets, biometric timestamps, end) on one client clock.
- The only fallback to `now()` is the single sanity rule above (absent/invalid/`endedAt < startedAt`). No other server-side timestamp policy.
- `client_timestamp_ms` is optional **on the wire** purely for backward compatibility with old clients; it is not a "maybe wire it" choice for the implementer.
- **`lastActivityAt` stays server `now()`, period.** The client clock drives only `startedAt`/`endedAt`. Splitting the shared `const now` in `startActivity` is mandatory, not stylistic — coupling `lastActivityAt` to client time reaps disconnected sessions inside the grace window (Watchdog safety section). Do not "simplify" by reusing one timestamp for all three fields.
- **Client-controlled duration is accepted as-is.** Client-sourced timestamps make `durationMs` client-determined; the only engine guard is `endedAt ≥ startedAt`. No downstream cap in `StatsService.finalise` — see note 59 which supersedes the earlier cap decision.
