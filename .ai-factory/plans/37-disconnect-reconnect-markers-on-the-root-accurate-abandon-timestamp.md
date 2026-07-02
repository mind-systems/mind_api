# Plan: Disconnect/reconnect markers on the root + accurate abandon timestamp

## Context
Annotate connection loss on the **root** session timeline by pushing `DISCONNECTED`/`RECONNECTED` markers once to the root id from the connection-level handlers, and record grace-abandoned sessions with `endedAt = disconnectedAt` so their duration is not inflated by the grace window. Spec: `.ai-factory/notes/23-connection-loss-markers.md`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Event constants & marker helper

- [x] **Task 1: Add `DISCONNECTED` and `RECONNECTED` to `StreamSessionEvent`**
  Files: `src/realtime/constants/stream-data-types.ts`
  Extend the `StreamSessionEvent` object with two new values: `DISCONNECTED: 'disconnected'` and `RECONNECTED: 'reconnected'`. Keep them alongside the existing `PAUSED`/`RESUMED` entries. This is additive to a free-form jsonb `event` field — no proto change, no change to the producing client. Unknown values are ignored by any reader not switching on them.

- [x] **Task 2: Allow `pushSessionEventMarker` to accept an explicit timestamp** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.ts`
  The existing private helper `pushSessionEventMarker(sessionId, event)` hardcodes `timestamp: Date.now()`. Add an optional third parameter (e.g. `timestampMs?: number`) and use it for the sample's `timestamp` when provided, otherwise fall back to `Date.now()`. **Preserve `serverMarker: true`** — it is what routes the marker through `StreamEngine.push()`'s immediate-persist branch (a root-keyed buffer has no producing client, so without it the marker would not persist reliably). Do not change existing call sites' behavior (they omit the new arg and keep `Date.now()`).

### Phase 2: Connection-level markers + accurate abandon

- [x] **Task 3: Emit root-keyed `DISCONNECTED`/`RECONNECTED` markers from the connection-level handlers** (depends on Task 2)
  Files: `src/realtime/services/activity-engine.service.ts`
  - In `handleTransportDisconnect(userId)`: resolve `const rootId = this.activitySessionStore.getRootId(userId)`. Capture a single disconnect timestamp for the whole connection (e.g. `const disconnectedAt = Date.now()`) before the per-session loop. **After** the per-session disconnect/grace-timer loop, if `rootId` is present, push **one** marker to the root: `pushSessionEventMarker(rootId, StreamSessionEvent.DISCONNECTED, disconnectedAt)`. Emit it exactly once on the root — never inside the per-session `onDisconnect` (which fires for the root and every child and would spam the timeline).
  - In `handleReconnect(userId, clientSessionId)`: capture a single reconnect timestamp (e.g. `const reconnectedAt = Date.now()`). When a root was actually resumed (i.e. `rootResult` is non-null / `rootId` was in the resumed set), push **one** marker to the root: `pushSessionEventMarker(rootId, StreamSessionEvent.RECONNECTED, reconnectedAt)`. Do not change the existing return value (`soleChildResult ?? rootResult ?? null`) or the `clientSessionId` abandonment-confirmation branch.
  - Do not change any per-session `SessionStatus` transitions — status stays per-session/internal; only the root-level timeline marker is added.

- [x] **Task 4: Use the disconnect instant as the abandon `endedAt`** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.ts`
  In `abandonActivity`, change `session.endedAt = now` to `session.endedAt = session.disconnectedAt ?? now`. This removes the ~grace-window inflation from grace-abandoned sessions' recorded duration. Leave the `session.status !== SessionStatus.DISCONNECTED` guard, the store cleanup, the log line, and the `SessionEvents.ABANDONED` emit unchanged. Do **not** touch `abandonStale` — its trigger is not a fresh disconnect.
