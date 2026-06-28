# Janitor for childless root sessions

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- Lazy root creation ([[04-lazy-root-creation]]) materializes a root on every stream connect. A reaper removes roots that have **no children**, after a TTL — regardless of whether they carry bio.
- Bio alone does **not** keep a root alive: a childless root is bio without any practice context ("noise without instructions" in the original design philosophy), and after the 1:1 migration a childless root is one whose practice was deleted. Deleting the root cascades its bio away (FK `ON DELETE CASCADE`). The only thing that protects a root is having at least one child.

## Details

### Current state — `src/realtime/services/session-watchdog.service.ts`
- Periodic `sweep()` (every `SESSION_SWEEP_INTERVAL_MS`) finds `ACTIVE`/`DISCONNECTED` sessions idle past `SESSION_MAX_IDLE_MS`, skips those with a live subscriber (`activeStreamRegistry.hasLiveSubscriber`), and calls `activityEngine.abandonStale`.

### Change
- Extend the watchdog (or add a sibling sweep) to find root sessions (`activityType = 'root'`) that are:
  - past an empty-root TTL by `lastActivityAt` (new config key `WS_EMPTY_ROOT_TTL_MS`), AND
  - have **no children** (`SELECT 1 FROM module_sessions WHERE "rootSessionId" = :root LIMIT 1` returns none),
  and **delete** them. The FK cascade removes any bio rows the root carried.
- Add `WS_EMPTY_ROOT_TTL_MS` to `src/realtime/constants/realtime-config.ts` + config.

### Guards / gotchas
- Never reap a root with a live subscriber (`hasLiveSubscriber(userId)`) — reuse the existing guard. A live root that is streaming bio but has not started a practice yet must survive (its `lastActivityAt` is refreshed by bio flush, so it is not stale anyway).
- The protecting condition is **children only**. Do not re-add a "has bio" exemption — that was the bug: after bio moved to the root, a "keep if bio" rule would make a deleted-practice root linger forever with orphaned bio.
- A root with even one child is real data and stays (and is excluded from stats separately, [[07-exclude-root-from-stats]]).
- Immediate (non-TTL) cleanup when a user deletes their last practice is handled in [[15-deleterun-orphan-root-cleanup]]; this janitor is the TTL backstop for disconnected idle roots.

### Verify
- Connect + disconnect with no practice and no bio → root deleted after TTL.
- Connect, stream bio only, never start a practice, disconnect → root reaped after TTL (idle bio discarded with it).
- Connect, start one activity, disconnect → root retained (has a child).

## Open Questions
- TTL value — start at the existing `SESSION_MAX_IDLE_MS` (10 min) unless a shorter empty-root window is wanted.
