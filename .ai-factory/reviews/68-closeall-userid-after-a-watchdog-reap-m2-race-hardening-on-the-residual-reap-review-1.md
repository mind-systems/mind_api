# Code Review — M2: `closeAll(userId)` after a watchdog reap

**Scope reviewed:** `src/realtime/services/session-watchdog.service.ts` (the only code change in `git diff HEAD`). The other staged files are plan/plan-review artifacts.

## Summary

The change adds a single line — `this.activeStreamRegistry.closeAll(row.userId)` immediately after `await this.activityEngine.abandonStale(row.userId, row.id)`, inside the existing per-row `try` block and before `reaped++`. It matches the plan and the spec (`notes/54`, §Mitigations — M2) precisely.

## Correctness verification against the plan's guards

- **Only on the reap path.** ✅ The call sits below the `hasLiveSubscriber` skip (`continue` at line 75), so rows belonging to live, connected clients are never closed.
- **After `abandonStale`, not before.** ✅ The engines finalize/flush via the `ABANDONED` event first; `closeAll` is the trailing cleanup.
- **Inside the existing `try`.** ✅ A throw from `closeAll` would be caught by the existing `catch` and not abort the rest of the sweep loop. In practice `closeAll` cannot throw here: it early-returns when `streams.get(userId)` is undefined (the common DB-orphan no-op), and otherwise only calls `subscriber.complete()` in a loop.
- **No injection / dependency change.** ✅ `activeStreamRegistry` was already injected in M1 and `closeAll` already exists (`active-stream-registry.service.ts:38`), iterating the user's subscriber set, completing each, then deleting the map entry. No DB/proto/schema/migration impact.

## Runtime / race analysis

- The intended race (client subscribes between the `hasLiveSubscriber` check at line 71 and `abandonStale` at line 82) is now covered: the straggler subscriber is `complete()`d, its `onDone` fires, and it reconnects to a clean state instead of being stranded on `NO_SESSION` batches with an open stream.
- `closeAll` mutates and deletes its own `Set`/`Map` entry while iterating its own copy of the set — safe; JS is single-threaded so no concurrent-mutation hazard.
- No new overlapping-sweep concern is introduced (the `setInterval` re-entrancy question is pre-existing and unchanged).

## Non-blocking observations (no action required for this milestone)

1. **Residual narrower race (out of scope, accepted by spec).** A subscriber that connects *after* `closeAll` runs in the same iteration — or after the whole sweep — for an already-`ABANDONED` session would again receive `NO_SESSION` on its batches with the stream left open. This is inherent to the watchdog approach and explicitly outside M2's scope (M2 targets the check→abandon window only). The normal client path opens the **control** stream first, which routes through `handleReconnect`, so this residual window is not reachable through the documented reconnect flow. Flagging for awareness, not as a defect in this change.

2. **No test added.** Plan declares `Testing: no`, and there is no existing `session-watchdog.service.spec.ts`, so this is consistent with the stated settings — noting only that the connect-during-sweep behavior remains uncovered by automated tests.

## Verdict

The change is correct, minimal, faithful to the plan and spec, and introduces no bugs, security issues, or runtime hazards.

REVIEW_PASS
