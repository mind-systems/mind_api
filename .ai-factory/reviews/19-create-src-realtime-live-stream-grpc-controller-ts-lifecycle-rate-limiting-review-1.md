## Code Review Summary

**Plan:** `19-create-src-realtime-live-stream-grpc-controller-ts-lifecycle-rate-limiting.md`
**Original commit:** `128bb67` (subsequently refactored in commits up to `2519b7e`)
**File Reviewed:** `src/realtime/module-session.grpc.controller.ts` (lines 133–148 — teardown block)
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md** — `PASS`: Controller remains thin. Teardown delegates all lifecycle logic to `ActivityEngine.handleTransportDisconnect()` and `PresenceService.offline()`. No cross-module boundary violations. `StateStore` and `GraceTimerManager` are no longer injected directly — they are encapsulated inside `ActivityEngine`, which is the correct ownership boundary.
- **RULES.md** — `PASS`: No PII in logs (only `userId` and `connectedDurationMs`). No non-null assertions — `connectedAt` is accessed via optional chaining (`?.connectedAt`) with a ternary fallback to `0`. Logging is lean: one disconnect log line plus one error-only catch.
- **ROADMAP.md** — `PASS`: Roadmap item (line 66) is marked `[x]`. All three planned deliverables (disconnect lifecycle, duration logging, rate-limiter eviction) are implemented.

### Verification of Planned Tasks

**Task 1 — Teardown with disconnect + grace timer:**
The original implementation (commit `128bb67`) called `onDisconnect()` + manual `stateStore.activityMap.has()` + `graceTimerManager.startTimer()` inline. Later refactoring (commits 14–18) replaced this with a single `activityEngine.handleTransportDisconnect(userId)` call, which encapsulates the same sequence internally: `onDisconnect()` → DB update to `DISCONNECTED` → `activitySessionStore.has()` → `startGraceTimer()` → on expiry: `abandonActivity()` with status guard. Correct and cleaner.

**Task 2 — connectedAt + duration logging:**
`presenceService.get(userId)?.connectedAt` is read synchronously at line 136, before the IIFE at line 140 calls `presenceService.offline()` (which deletes the `presenceMap` entry). JavaScript single-threaded execution guarantees the read completes before the IIFE's synchronous body runs. `connectedAt` is a `Date` object (created via `new Date()` in `presenceService.online()`), so `.getTime()` is safe. If the entry doesn't exist (teardown fires before `setup()` calls `online()`), optional chaining returns `undefined` and the ternary falls back to `0`. Correct.

**Task 3 — Rate-limiter eviction:**
`rateLimiterService.evict('activity-start:${userId}')` at line 147 matches the key format used by `consume('activity-start:${userId}', ...)` at line 203. `evict()` is a simple `Map.delete()` — no-op on non-existent keys. Correct.

### Edge Cases Verified

- **Teardown before `setup()` completes:** `get(userId)` returns `undefined` → duration `0`. `offline()` is a no-op on a missing Map key. `handleTransportDisconnect()` → `onDisconnect()` returns early when `activitySessionStore` has no entry. No grace timer started. All safe.
- **Teardown during `handleReconnect()` await:** The `subscriber.closed` guard (line 86, added in commit `2519b7e`) prevents `setup()` from calling `presenceService.online()` after teardown has already called `offline()`. Race condition addressed.
- **IIFE error propagation:** The `.catch()` at line 143 catches any error from `offline()` or `handleTransportDisconnect()` and logs it. The synchronous operations outside the IIFE (`deregister`, `connectedAt` read, `evict`) are not affected by IIFE failures.

### Positive Notes

- The refactoring from inline `onDisconnect` + `stateStore` + `graceTimerManager` to a single `handleTransportDisconnect()` call follows the architecture's "thin controller" principle well — the controller no longer needs to know about grace timer mechanics.
- Error handling pattern (async IIFE + `.catch()`) is consistent with the project's existing conventions.
- The `connectedAt` read-before-delete ordering is deliberate and correct — a subtle but important detail.

REVIEW_PASS
