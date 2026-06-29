# Stop the server self-mutating pause state across reconnect

**Date:** 2026-06-29
**Source:** conversation context

## Key Findings

- The server silently changes pause state it does not own. `resumeActivity` resets `state.isPaused = false` on **every** reconnect (`src/realtime/services/activity-engine.service.ts:573`), and the reconnect `session:state` event reports `isPaused: false` hardcoded (`src/realtime/module-state.grpc.controller.ts:142`). A session the user paused therefore comes back **unpaused** without any command from the user.
- Consequence: after a reconnect the client's next `activity:resume` is rejected with `NOT_PAUSED` (guard at `activity-engine.service.ts:508`) — a real bug, not "the client should tolerate it."
- Pause/unpause is **client-owned**: the only legitimate writers of pause state are the explicit `activity:pause` / `activity:resume` commands. The server must never flip it on its own (disconnect, reconnect, or otherwise).

## Details

### Current state
- `ActivityState.isPaused` (`src/realtime/interfaces/activity-state.interface.ts`) is the only live pause flag. It is read in exactly two places: `pauseActivity` guard (`:467`, throws `ALREADY_PAUSED`) and `unpauseActivity` guard (`:508`, throws `NOT_PAUSED`). It is written `true` at `:471` (pause), `false` at `:512` (unpause), and **wrongly** `false` at `:573` (resumeActivity).
- On a normal reconnect the in-memory store **retains** the `ActivityState` entry (it is not removed on disconnect) — so the only thing destroying the pause flag is the `:573` reset.
- `module-state.grpc.controller.ts` emits `isPaused` in `session:state`: `:142` (reconnect, hardcoded `false`), `:468` (pause → `true`), `:503` (unpause → `false`).

### Change
1. Remove `state.isPaused = false;` from `resumeActivity` — leave the flag exactly as it was before the disconnect.
2. In the reconnect emission path (`module-state.grpc.controller.ts:142`), report the **actual** resumed session's `isPaused`, not a hardcoded `false`.

### Surfacing the live flag (structural — pin before implementing)
The reconnect emission today hardcodes `isPaused: false` at `module-state.grpc.controller.ts:142`. Two constraints make the obvious fix wrong:
- The controller's ctor has **no `ActivitySessionStore`** dependency (`activityEngine, rateLimiterService, activeStreamRegistry, configService, eventEmitter`) — it cannot read `store.getSession(...)?.isPaused` directly.
- `handleReconnect` returns a `ModuleSession` **entity**, which has **no `isPaused` field** (pause is not a column — see [[25-persist-ispaused]]). Reading `result.isPaused` off the entity is a permanent-`undefined` trap.

So surface the live flag **through the `ActivityEngine`** (which owns the store): either have `handleReconnect` return the resumed session's live `isPaused` alongside it, or expose `activityEngine.getSession(userId, resolvedId)?.isPaused` for the controller to read at emission time. Pick one and pin it here before implementing. The live `isPaused` comes from the in-memory `ActivityState` (preserved by change #1), **not** from the entity or any column.

### Anti-target (invert when this lands)
- `module-state.grpc.controller.spec.ts` — the `(a)` RESUMED reconnect case (`:151-180` in `5221b38`) asserts `toMatchObject({ status: RESUMED, isPaused: false })` (the old hardcode). The generic corrective test [[37-test-root-as-activity-type]] lands first and reverts this case to `[RESUMED]` `toHaveLength(1)` (no connect ROOT frame — the pivot made the root a client-started `activity_type=ROOT` session). On that len-1 shape, **invert** into two cases: resumed-unpaused → `isPaused: false`, resumed-paused → `isPaused: true` (read from the surfaced live flag).

### Inlined contracts
- After this change the server changes pause state **only** via `pauseActivity` / `unpauseActivity` (explicit client commands). Disconnect/reconnect preserve it.
- This fixes the **in-memory** case (normal reconnect, store retained). Surviving a **server restart** requires the pause record to be durable in the timeline — which it is, because the `PAUSED`/`RESUMED` markers are `SESSION_EVENT` and the foundational task [[25-persist-ispaused]] persists every such marker immediately at emit. [[26-state-rehydration]] then **derives** `isPaused` from them on boot. **No `module_sessions` pause column** anywhere.

### Guards / gotchas
- Do not touch the `pauseActivity` / `unpauseActivity` guards or their `true`/`false` writes — they are correct.
- No proto change (`is_paused` already exists on `StateEvent`).

### Verify
- Pause a session → drop the transport → reconnect within grace: `session:state` reports `is_paused = true`, and a subsequent `activity:resume` succeeds (no `NOT_PAUSED`).
- Pause is never observed flipping to active without an explicit client `activity:resume`.

## Open Questions
- None.
