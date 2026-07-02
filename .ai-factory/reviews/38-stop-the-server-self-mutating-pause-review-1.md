# Code Review: Stop the server self-mutating pause

**Plan:** `.ai-factory/plans/38-stop-the-server-self-mutating-pause.md`
**Files changed:** `src/realtime/services/activity-engine.service.ts`, `src/realtime/module-state.grpc.controller.ts`
**Risk:** 🟢 Low

## Scope of change
Two edits, both matching the plan exactly:
1. `activity-engine.service.ts` — removed `state.isPaused = false;` from `resumeActivity` (was line 598, immediately after `state.lastActivityAt = now;`).
2. `module-state.grpc.controller.ts` — replaced the hardcoded `isPaused: false` in the reconnect RESUMED emission (line 173) with `this.activityEngine.getSession(userId, result.id)?.isPaused ?? false`.

## Correctness verification

- **State survives to emission time.** `handleReconnect` returns `soleChildResult ?? rootResult ?? null` — always a `ModuleSession` that `resumeActivity` successfully resumed. `resumeActivity` returns `null` unless it found the session in the store (guard at `:580-581`), so a non-null `result` guarantees `getSession(userId, result.id)` resolves the live `ActivityState`. With Task 1 no longer clearing the flag, the reported `isPaused` is the value preserved from before the disconnect. ✅
- **No intervening eviction.** The emission runs synchronously right after `handleReconnect` returns, inside the same `async setup()`; there is no `await` between resume and emission that could remove the store entry. ✅
- **`getSession` resolves both shapes.** `ActivitySessionStore.getSession` (`:108`) is a child-or-root lookup, so it correctly resolves whether `result.id` is a child or the root slot. Root sessions are never paused, so the root branch yields `false`, which is correct. ✅
- **Type safety.** `ActivityState.isPaused` is `boolean`; `?.isPaused ?? false` coerces the `undefined` (not-found) case to a real `boolean`, matching the proto `is_paused` field. No `!` non-null assertion used (RULES compliant). ✅
- **Variables in scope.** `userId` (`:143`) and `result.id` are both in scope at the emission site. ✅
- **No orphaned consumers.** A full `isPaused` sweep of `src/realtime` (non-spec) confirms writes now occur only via client-owned `pauseActivity` (`:500`) / `unpauseActivity` (`:535`), and reads only in their guards (`:496`, `:531`) plus the new emission (`:175`). No other code path depended on resume clearing the flag. ✅

## Plan-forbidden traps — all avoided
- Did **not** read `result.isPaused` off the `ModuleSession` entity (which has no such field). ✅
- Did **not** add an `ActivitySessionStore` dependency to the controller — routed through the already-injected `ActivityEngine`. ✅
- Preserved the adjacent `activityType: mapInternalActivityType(result.activityType)` and the `moduleSessionId` / `status: RESUMED` fields untouched. ✅
- `pauseActivity` / `unpauseActivity` guards and their `true`/`false` writes left intact. ✅

## Runtime concerns
- No migration needed (pause is in-memory only, no `module_sessions` column). ✅
- No proto change (`is_paused` already on `StateEvent`). ✅
- No race condition: the module-state stream is single-subscriber per user, driven synchronously in `setup()`. ✅
- Logging untouched, consistent with "Logging: minimal". ✅

## Findings
None.

REVIEW_PASS
