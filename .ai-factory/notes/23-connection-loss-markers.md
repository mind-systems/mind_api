# Annotate connection loss on the root timeline

**Date:** 2026-06-29
**Source:** conversation context

## Key Findings

- A dropped connection leaves no trace in the instruction timeline: `onDisconnect` and `resumeActivity` (`src/realtime/services/activity-engine.service.ts`) only `repo.update` the session row — neither pushes a `session_event` marker. A child's `breath_phase`/bio gap during a disconnect is therefore indistinguishable from the user simply going idle.
- A grace-abandoned session records `endedAt = now` (grace expiry), inflating its recorded duration by the full grace window (~30s).
- Connection loss is a property of the **root** session — one transport drops the root **and** all its children together (`handleTransportDisconnect` iterates `[rootId, ...childIds]`). It must be annotated **once on the root**, never per child.

## Details

### Current state
- `StreamSessionEvent` (`src/realtime/constants/stream-data-types.ts`) = `STARTED, ENDED, ABANDONED, INTERRUPTED, PAUSED, RESUMED`. No `DISCONNECTED`/`RECONNECTED`.
- Markers are pushed via `this.streamEngine.push(sid, { timestamp, data: { dataType: StreamDataType.SESSION_EVENT, event: StreamSessionEvent.X } })`. Today **all** instruction pushes are keyed by a **child** id — there are no root-keyed entries in `session_stream_samples`.
- `handleTransportDisconnect(userId)` collects `getRootId(userId)` + `listChildren(...)`, calls `onDisconnect(userId, sid)` per session, and arms a per-session grace timer.
- `handleReconnect(userId, clientSessionId)` cancels grace and calls `resumeActivity(userId, sid)` per session, returning `soleChild ?? root`.
- `abandonActivity` sets `session.endedAt = now` then pushes `ABANDONED`. `onDisconnect` sets `status = DISCONNECTED, disconnectedAt = now`.

### Change
1. Add two values to `StreamSessionEvent`: `DISCONNECTED: 'disconnected'`, `RECONNECTED: 'reconnected'`.
2. Emit the **DISCONNECTED** marker **once, to the root id**, at the connection-level handler `handleTransportDisconnect` (resolve `rootId = getRootId(userId)`; skip if absent) — **not** inside the per-session `onDisconnect` (which fires for the root *and* every child → would spam). Use the disconnect timestamp.
3. Emit the **RECONNECTED** marker **once, to the root id**, in `handleReconnect` when a root was resumed.
4. In `abandonActivity`, set `session.endedAt = session.disconnectedAt ?? now` instead of `now`.

### Inlined contracts
- Marker push shape: `streamEngine.push(rootId, { timestamp: <disconnect or reconnect ms>, data: { dataType: StreamDataType.SESSION_EVENT, event: StreamSessionEvent.DISCONNECTED | RECONNECTED } })`.
- `session_event.data` is free-form jsonb — **no proto change**, no change to the producing client. Only timeline **readers** (web dashboard, future coach service) gain two new optional `event` values; unknown values are simply ignored by anything not switching on them.
- A child interprets its own window by reading the **root's** connection events overlapping `[child.startedAt, child.endedAt]` — the same windowing it already uses for root bio.

### Guards / gotchas
- One marker per connection event on the **root**, never per child.
- Session **status** transitions (`DISCONNECTED` on each session for grace/abandon) are unchanged — only the timeline **marker** is added at root level. Do not conflate status (per-session, internal) with the marker (root-level, for analytics).
- These become the first root-keyed rows in `session_stream_samples` — that is intended and additive.

### Verify
- Kill the app mid-practice → one `disconnected` event on the root timeline at the drop instant.
- Reconnect within grace → one `reconnected` event on the root.
- Let a session grace-abandon → its `endedAt` equals its `disconnectedAt`, not the grace-expiry time.

## Open Questions
- None.
