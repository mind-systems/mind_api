# Plan: Stop the server self-mutating pause

## Context
Remove the two spots where the server silently clears a session's pause state on reconnect, so a paused session stays paused across a disconnect/reconnect and the next `activity:resume` is not wrongly rejected with `NOT_PAUSED`. Spec: `.ai-factory/notes/24-pause-state-integrity.md`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Preserve and surface the live pause flag

- [x] **Task 1: Stop resetting `isPaused` on resume**
  Files: `src/realtime/services/activity-engine.service.ts`
  In `resumeActivity`, delete the line `state.isPaused = false;` (currently line 598, right after `state.lastActivityAt = now;`). Leave the in-memory `ActivityState.isPaused` exactly as it was before the disconnect — the store retains the entry across a normal reconnect, so no other write is needed. Do not touch anything else in `resumeActivity`, and do not touch the `pauseActivity`/`unpauseActivity` guards or their `true`/`false` writes.

- [x] **Task 2: Report the actual `isPaused` in the reconnect `session:state`** (depends on Task 1)
  Files: `src/realtime/module-state.grpc.controller.ts`
  In the reconnect RESUMED emission block (lines 169-176), change **only** the hardcoded `isPaused: false` (line 173) to read the live flag through `ActivityEngine`:
  ```ts
  isPaused: this.activityEngine.getSession(userId, result.id)?.isPaused ?? false,
  ```
  `activityEngine.getSession(userId, sessionId): ActivityState | undefined` already exists (`activity-engine.service.ts:554`, a thin delegate to `activitySessionStore.getSession`) and returns the live `ActivityState` carrying `isPaused`. The `?? false` keeps the resumed-unpaused case a real boolean.
  Do **not** read `result.isPaused` off the returned `ModuleSession` entity (it has no such field — permanent `undefined`), and do **not** add an `ActivitySessionStore` dependency to the controller. Preserve the adjacent `activityType: mapInternalActivityType(result.activityType)` (line 174) and the other emission fields (`moduleSessionId`, `status: RESUMED`) untouched — this change edits `isPaused` and nothing else. No proto change (`is_paused` already exists on `StateEvent`).
