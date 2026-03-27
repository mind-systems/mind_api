## Code Review Summary

**Files Reviewed:** 10 (new: 1, modified: 7, deleted: 2)
**Risk Level:** Low

### Context Gates

- **ARCHITECTURE.md** — WARN: no violations. `ActivitySessionStore` is a module-internal service correctly registered in `RealtimeModule` providers/exports. Module boundary rules respected — no cross-module repository access or import leaks.
- **RULES.md** — WARN: pre-existing `state!.sessionId` / `state!.activityType` non-null assertions exist in `activity-engine.service.spec.ts` (lines 85-86), but these were **not introduced** by this milestone (context lines in diff, preceded by `expect(state).toBeDefined()`). No new violations.
- **ROADMAP.md** — OK: milestone 3.6 item "Migrate `activityMap` out of `LiveGateway`" correctly marked `[x]`.

### Verification

| Check | Result |
|---|---|
| TypeScript compilation (`tsc --noEmit`) | Pass — zero errors |
| Unit tests (`npx jest`) | 119 passed, 1 pre-existing failure (`auth.service.spec.ts` — unrelated) |
| Realtime-scoped tests (`activity-engine.service.spec.ts`) | 12/12 pass |
| No stale `GraceTimerManager` references in `src/` | Confirmed — zero hits |
| No stale `stateStore.activityMap` references in `src/` | Confirmed — zero hits |
| `grace-timer.service.ts` + spec deleted | Confirmed |
| DI wiring (`RealtimeModule`) | `ActivitySessionStore` in providers + exports; `GraceTimerManager` removed |

### Critical Issues

None.

### Suggestions

None.

### Positive Notes

- **Clean extraction.** `ActivitySessionStore` correctly absorbs both the Map CRUD wrapper and the grace timer logic with identical semantics (double-start cancels previous, cancel is no-op when absent, timer self-cleans from map on fire). The `void onExpiry()` pattern correctly handles `Promise<void>` callbacks without awaiting.
- **Faithful behavior preservation.** `handleReconnect` and `handleTransportDisconnect` centralise the reconnect/disconnect logic that was duplicated across `LiveGateway` and `LiveStreamGrpcController`. All ~15 `stateStore.activityMap.*` call sites mechanically replaced — no semantic changes to `startActivity`, `endActivity`, `onDisconnect`, `abandonActivity`, `stopActivity`, `pauseActivity`, `unpauseActivity`, `getActiveSession`, or `resumeActivity`.
- **Good test migration.** Spec uses a real `ActivitySessionStore` instance (it's simple in-memory — no mocking needed) rather than a mock, giving higher confidence. Gateway spec properly tests the new `handleReconnect`/`handleTransportDisconnect` contract instead of reaching into internal state.
- **Complete cleanup.** No orphan imports, no dead code, module wiring updated, `StateStore` slimmed to only `presenceMap`.

REVIEW_PASS
