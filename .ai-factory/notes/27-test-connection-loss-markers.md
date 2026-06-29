# Test plan — connection-loss markers + accurate abandon timestamp (silent-bug-first, TDD)

**Date:** 2026-06-29
**Source:** conversation context

Covers feature task [[23-connection-loss-markers]]. Written **before** the feature: committed RED, turns GREEN when note 23 lands.

## Test authoring constraints
- **L1 — outcomes only:** assert the mock-visible `streamEngine.push` call (its `sessionId` arg + `data.event` string), and the `repo.save` argument's `endedAt`. Never inspect private buffers or the stream-engine internal store.
- **L2 — compile-now:** `StreamSessionEvent.DISCONNECTED`/`RECONNECTED` do **not** exist yet (`stream-data-types.ts:6-13` has only STARTED/ENDED/ABANDONED/INTERRUPTED/PAUSED/RESUMED). Assert the **literal strings** `'disconnected'` / `'reconnected'`, not the enum member, or the test will not compile.
- **L3 — label by spec name:** target cases `RED until spec 23-connection-loss-markers`; never a phase number.
- **L4 — escalation valve:** per-session status transitions and existing markers are characterization. A RED there after note 23 = genuine regression, escalate.

## Why this area (silent-failure filter)
A dropped connection leaves **no** trace in the instruction timeline — `onDisconnect`/`resumeActivity` only `repo.update` the row, no marker — so a child's `breath_phase`/bio gap is indistinguishable from the user idling. And a grace-abandon records `endedAt = now` (grace expiry), silently inflating duration by the grace window (~30s). Both fail silently. The loud parts (a missing enum value → compile error) are skipped.

## Behavior under change — think before writing
The marker is a **connection-level** event: one transport drops the root **and** all children together (`handleTransportDisconnect` iterates `[rootId, ...childIds]`). It must be emitted **once, on the root**, not once per child — the spam trap. Re-derive: with N children, exactly one `'disconnected'` push, keyed to `rootId`.

## Red/Green contract
- **Target (RED until [[23-connection-loss-markers]]):** the marker emissions + the `endedAt` change.
- **Characterization (GREEN, stay GREEN):** per-session `onDisconnect` → status `DISCONNECTED` + grace timer; existing STARTED/ENDED/ABANDONED/PAUSED/RESUMED markers; `abandonStale`'s `endedAt = now` fallback for never-disconnected sessions.

## Instantiation
`ActivityEngine(repo, activitySessionStore, eventEmitter, streamEngine)` — 4 ctor args (`activity-engine.service.ts:27-32`). Use a **real** `ActivitySessionStore(configService)` seeded via `setRoot(userId, rootId, state)` + `addChild(userId, childId, state)` so `getRootId`/`listChildren` resolve a root + ≥2 children; mock `streamEngine` with a `push` jest.fn spy; mock `repo` (`findOne`/`save`/`update`) for `abandonActivity`.

## Test cases
### Markers (target → 23)
- `handleTransportDisconnect` emits exactly **one** `push` with `data.event === 'disconnected'`, and its `sessionId` arg `=== rootId` — with a root + 2 children seeded, assert call count == 1 (the spam guard) and the id.
- `handleReconnect` emits exactly **one** `push` with `data.event === 'reconnected'` to `rootId` when a root was resumed.
### Abandon timestamp (target → 23)
- `abandonActivity` on a session with `disconnectedAt` set saves `endedAt === disconnectedAt` (assert the `repo.save` argument), **not** `now`.
### Unchanged (characterization)
- `onDisconnect` still sets status `DISCONNECTED` + `disconnectedAt`; per-session grace timers still armed.
- `abandonStale` on a never-disconnected (`disconnectedAt = null`) stale session still saves `endedAt = now` (the fallback survives).
- `startActivity`/`endActivity`/`pauseActivity`/`unpauseActivity` markers unchanged (STARTED/ENDED/PAUSED/RESUMED).

## Exact pins (read from source)
- **Marker shape:** `streamEngine.push(sessionId, { timestamp, data: { dataType: StreamDataType.SESSION_EVENT, event } })` (`activity-engine.service.ts:150` and siblings). Assert `data.dataType === StreamDataType.SESSION_EVENT` (value `'session_event'`) and `data.event === 'disconnected'`/`'reconnected'`.
- **Emission site (escalate to note 23):** the `DISCONNECTED` push lands in `handleTransportDisconnect` (`activity-engine.service.ts:631`) **once**, resolving `rootId = getRootId(userId)` (skip if null) — **not** inside the per-session `onDisconnect` (`:258`, which fires for the root *and* every child → the spam the test forbids). The `RECONNECTED` push lands once in `handleReconnect` (`:588`). If note 23 instead emits per-session, this milestone's spam-guard case stays RED — re-pin here first.
- **`endedAt` change:** `abandonActivity` (`:275`) currently `session.endedAt = now` before `repo.save`. Note 23 → `session.endedAt = session.disconnectedAt ?? now`. Assert the saved row's `endedAt` equals the fixture's `disconnectedAt`.
- **`abandonStale` is a SEPARATE method** (`:324`, `endedAt = now` at `:347`) — note 23 must **not** touch it; the `disconnectedAt`-less fallback char drives this path.
- **`onDisconnect`** (`:258`) only does `repo.update({ status: DISCONNECTED, disconnectedAt })` — no push today; this is the RED baseline for the marker target.

## Gotchas
- Use literal `'disconnected'`/`'reconnected'` (L2) — the enum value does not exist until note 23.
- The spam guard is the load-bearing assertion: count the `'disconnected'` pushes (== 1) AND check the id arg is the root, not a child.
- These become the first **root-keyed** rows in `session_stream_samples` — intended; do not treat a root-keyed push as a bug.
- Do NOT test the cross-timeline READ that surfaces root markers onto a child's view — that read is deferred (no consumer yet); this milestone covers only the write side + `endedAt`.

## Findings / escalation to note 23
1. Emit `DISCONNECTED` once to `rootId` in `handleTransportDisconnect`, `RECONNECTED` once to `rootId` in `handleReconnect` — never per-child.
2. Add `DISCONNECTED: 'disconnected'`, `RECONNECTED: 'reconnected'` to `StreamSessionEvent`.
3. `abandonActivity.endedAt = disconnectedAt ?? now`; leave `abandonStale` on `now`.
