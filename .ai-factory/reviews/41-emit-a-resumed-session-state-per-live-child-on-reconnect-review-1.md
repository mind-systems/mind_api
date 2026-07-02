# Code Review: Emit a RESUMED session:state per live child on reconnect

**Scope reviewed:** `git diff HEAD` — two source files:
- `src/realtime/services/activity-engine.service.ts` (new `listChildren` delegate)
- `src/realtime/module-state.grpc.controller.ts` (per-child reconnect fan-out)

## Verification performed

Read both changed files in full plus the surrounding invariants:
- `ActivityEngine.handleReconnect` (`activity-engine.service.ts:608-658`)
- `ActivitySessionStore.listChildren` (`activity-session-store.service.ts:116-120`)
- The reconnect `setup()` closure and its guards (`module-state.grpc.controller.ts:149-205`)

## Correctness analysis

1. **Branch gating is sound.** The RESUMED `else` branch is reached only when `handleReconnect` returns a non-null `ModuleSession` (not `{ abandoned: true }`). Per `handleReconnect`, a non-null `ModuleSession` is returned exactly when `sessionIds.length > 0` (root and/or children existed and were resumed) — `resumeActivity` always returns a saved session, so `soleChildResult ?? rootResult` is non-null in that case. So entering the branch guarantees at least one live session.

2. **No store race.** `handleReconnect` is awaited (line 150); the new `listChildren(userId)` call (line 169) runs with **no intervening `await`**. The in-memory store snapshot the controller reads is identical to the one the reconnect loop just mutated. Grace timers for these sessions were cancelled inside `handleReconnect` before the resume loop, so no child is abandoned mid-flight.

3. **No root-frame regression.** When children exist, the pre-change code returned `soleChildResult` (always a child, never root, because `??` prefers it), so a root frame was never emitted on this path before. The new per-child loop is strictly additive — it surfaces the previously-dropped siblings.

4. **Fallback path is genuinely unchanged and correct.** When `listChildren` is empty, `result` is necessarily the root (children absent ⇒ `soleChildResult` was null ⇒ `rootResult` returned). The fallback emits `result.id` with `getSession(...)?.isPaused ?? false` — byte-for-byte identical to the prior behavior.

5. **Types check out.** `child.isPaused` is a required boolean on `ActivityState`; `child.activityType` is the same `InternalActivityType` accepted by `mapInternalActivityType` (no cast); `child.sessionId` is a string. `listChildren` excludes the root, so no `ROOT` activityType leaks into a child frame.

6. **No mid-loop close hazard.** `subscriber.next` is synchronous with no `await` inside the loop; the existing `if (subscriber.closed) return;` at line 154 remains sufficient. Calls to `.next()` on an already-closed RxJS subscriber are no-ops, not crashes.

7. **No proto change, no migration, no new dependency.** `StateEvent` already carries the fields used; `userId` is derived from the validated JWT (`user.sub`), so no ownership/authorization surface is introduced.

## Findings

None. The implementation matches the pinned spec and plan, preserves the fallback path exactly, and introduces no runtime, type, or race hazards.

REVIEW_PASS
