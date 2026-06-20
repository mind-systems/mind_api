# Plan: `closeAll(userId)` after a watchdog reap (M2) — race-hardening on the residual reap

## Context
Close the connect-during-sweep race: after `SessionWatchdogService.sweep` reaps a stale session via `abandonStale`, call `ActiveStreamRegistry.closeAll(userId)` so a subscriber that connected between the M1 liveness check and the reap is completed (its `onDone` fires → reconnect to a clean state) instead of being stranded with `NO_SESSION` on an open stream.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Race-cleanup on reap

- [x] **Task 1: Call `closeAll(userId)` after each successful reap in `sweep`**
  Files: `src/realtime/services/session-watchdog.service.ts`
  In `sweep()`, inside the per-row loop, after `await this.activityEngine.abandonStale(row.userId, row.id)` succeeds (within the same `try` block, before `reaped++` or immediately after it), call `this.activeStreamRegistry.closeAll(row.userId)`. This completes any subscriber that opened between the M1 `hasLiveSubscriber(row.userId)` skip-check (line 71) and the `abandonStale` call — the connect-during-sweep straggler — so its stream closes, `onDone` fires, and the client reconnects clean. The registry is already injected (`this.activeStreamRegistry`, M1) and `closeAll` already exists (`active-stream-registry.service.ts:38` — completes every subscriber for the userId, then deletes the entry). No injection or new dependency needed.

  Guards / hard requirements:
  - **Only on the reap path.** Do NOT call `closeAll` for rows skipped by the M1 `hasLiveSubscriber` check (the `continue` branch) — those are live, connected clients and must never be closed.
  - **After `abandonStale`, not before** — the engines must finalize/flush via the `ABANDONED` event first; closing streams is the trailing cleanup.
  - **Keep it inside the existing `try`** so a `closeAll` throw is caught by the existing `catch` and does not abort the rest of the sweep loop. (On the common no-subscriber DB-orphan case `closeAll` is a harmless no-op — `streams.get(userId)` is undefined → early return.)
  - Do not touch the DB query, the M1 skip predicate, the threshold/config reads, the timer lifecycle, or `abandonStale` itself. No proto / schema / migration change.

## Notes
- This is the M2 cleanup contract, not the P2 fix — P2 (split-brain) is already eliminated by M1, since a session with any live subscriber is never reaped. M2 only covers the narrow connect-during-sweep race.
- Depends on M1 (already shipped: `ActiveStreamRegistry` injected, `hasLiveSubscriber` skip in place).
- Spec: `.ai-factory/notes/54-watchdog-liveness-proxy-risks.md` (§Mitigations — M2).
