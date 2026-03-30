# Review: Fix `docs/stats/stats.md`

## Changes reviewed

- `docs/stats/stats.md` — two edits in the architecture diagram (lines 102, 104)

## Verification

| Check | Result |
|-------|--------|
| `GraceTimerManager` no longer exists in `src/` | ✅ Zero matches — old name is dead code |
| `ActivitySessionStore` exists at `src/realtime/services/activity-session-store.service.ts` | ✅ Confirmed |
| `ActivityEngine` emits all three events (`completed`, `abandoned`, `interrupted`) | ✅ `activity-engine.service.ts` |
| `StatsWorker` has `@OnEvent` handlers for all three events | ✅ Lines 13, 32, 51 in `stats.worker.ts` |
| `StatsService.finalise()` method exists | ✅ Line 36 in `stats.service.ts` |
| Prose section (line 68) already lists all three events | ✅ No inconsistency |
| Diagram now matches code | ✅ All component names and event names are accurate |

## Issues

None found. Both edits are correct and consistent with the source code.

REVIEW_PASS
