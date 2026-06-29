# Stop the server self-mutating pause state across reconnect

**Date:** 2026-06-29
**Source:** conversation context

## Key Findings

- The server silently changes pause state it does not own. `resumeActivity` resets `state.isPaused = false` on **every** reconnect (`src/realtime/services/activity-engine.service.ts:581`), and the reconnect `session:state` event reports `isPaused: false` hardcoded (`src/realtime/module-state.grpc.controller.ts:173`, in the reconnect emission block `:169-176`). A session the user paused therefore comes back **unpaused** without any command from the user.
- Consequence: after a reconnect the client's next `activity:resume` is rejected with `NOT_PAUSED` (guard at `activity-engine.service.ts:508`) — a real bug, not "the client should tolerate it."
- Pause/unpause is **client-owned**: the only legitimate writers of pause state are the explicit `activity:pause` / `activity:resume` commands. The server must never flip it on its own (disconnect, reconnect, or otherwise).

## Details

### Current state
- `ActivityState.isPaused` (`src/realtime/interfaces/activity-state.interface.ts`) is the only live pause flag. It is read in exactly two places: `pauseActivity` guard (`:467`, throws `ALREADY_PAUSED`) and `unpauseActivity` guard (`:508`, throws `NOT_PAUSED`). It is written `true` at `:471` (pause), `false` at `:512` (unpause), and **wrongly** `false` at `:581` (resumeActivity).
- On a normal reconnect the in-memory store **retains** the `ActivityState` entry (it is not removed on disconnect) — so the only thing destroying the pause flag is the `:581` reset.
- `module-state.grpc.controller.ts` emits `isPaused` in `session:state`: `:173` (reconnect, hardcoded `false`), `:539` (pause → `true`), `:575` (unpause → `false`).

### Change
1. Remove `state.isPaused = false;` from `resumeActivity` (`activity-engine.service.ts:581`) — leave the flag exactly as it was before the disconnect.
2. In the reconnect emission block (`module-state.grpc.controller.ts:169-176`), change **only** the hardcoded `isPaused: false` (`:173`) to report the **actual** resumed session's `isPaused`. **Preserve the adjacent `activityType` field** (`:174`, `activityType: mapInternalActivityType(result.activityType)`, added by a1) — it is the root/child discriminator the client now reads; editing/rewriting the emission must touch `isPaused` and nothing else. The other emission fields (`moduleSessionId`, `status: RESUMED`) stay.

### Surfacing the live flag (pinned — backed by a real method)
The reconnect emission today hardcodes `isPaused: false` at `module-state.grpc.controller.ts:173`. Two constraints make the naïve fix wrong:
- The controller's ctor has **no `ActivitySessionStore`** dependency (`activityEngine, rateLimiterService, activeStreamRegistry, configService, eventEmitter`) — it cannot read `store.getSession(...)?.isPaused` directly.
- `handleReconnect` returns a `ModuleSession` **entity**, which has **no `isPaused` field** (pause is not a column — see [[25-persist-ispaused]]). Reading `result.isPaused` off the entity is a permanent-`undefined` trap.

**Pinned mechanism** (no longer hypothetical — a1 added the delegate): surface the live flag through `ActivityEngine`. At emission time read
```ts
isPaused: this.activityEngine.getSession(userId, result.id)?.isPaused ?? false,
```
`activityEngine.getSession(userId, sessionId): ActivityState | undefined` exists at `activity-engine.service.ts:537` (a thin delegate to `activitySessionStore.getSession`) and returns the live `ActivityState`, which carries `isPaused`. The `?? false` keeps the resumed-**unpaused** case a real boolean (and makes the unmocked test path assert a concrete `false`, not `undefined`). The live `isPaused` comes from the in-memory `ActivityState` (preserved by change #1), **not** from the entity or any column. (a1 also added `getRootId` at `:545`, `string | null` — not needed here, noted only so the surrounding engine API is unambiguous.)

### Anti-target (invert when this lands)
- `module-state.grpc.controller.spec.ts` — the `(a)` RESUMED reconnect case (`:151-180` in `5221b38`) asserts `toMatchObject({ status: RESUMED, isPaused: false })` (the old hardcode). The generic corrective test [[37-test-root-as-activity-type]] lands first and reverts this case to `[RESUMED]` `toHaveLength(1)` (no connect ROOT frame — the pivot made the root a client-started `activity_type=ROOT` session). On that len-1 shape, **invert** into two cases: resumed-unpaused → `isPaused: false`, resumed-paused → `isPaused: true` (read from the surfaced live flag).

### Inlined contracts
- After this change the server changes pause state **only** via `pauseActivity` / `unpauseActivity` (explicit client commands). Disconnect/reconnect preserve it.
- This fixes the **in-memory** case (normal reconnect, store retained). Surviving a **server restart** requires the pause record to be durable in the timeline — which it is, because the `PAUSED`/`RESUMED` markers are `SESSION_EVENT` and the foundational task [[25-persist-ispaused]] persists every such marker immediately at emit. [[26-state-rehydration]] then **derives** `isPaused` from them on boot. **No `module_sessions` pause column** anywhere.

### Guards / gotchas
- Do not touch the `pauseActivity` / `unpauseActivity` guards or their `true`/`false` writes — they are correct.
- **Preserve `activityType` in the reconnect emission** (`module-state.grpc.controller.ts:174`). The block now emits `{ moduleSessionId, status: RESUMED, isPaused, activityType }`; this change edits **only** `isPaused`. Dropping `activityType` would strip the root/child discriminator the client reads after a1 — a silent regression.
- No proto change (`is_paused` already exists on `StateEvent`).

### Verify
- Pause a session → drop the transport → reconnect within grace: `session:state` reports `is_paused = true`, and a subsequent `activity:resume` succeeds (no `NOT_PAUSED`).
- Pause is never observed flipping to active without an explicit client `activity:resume`.

## Open Questions
- None.
