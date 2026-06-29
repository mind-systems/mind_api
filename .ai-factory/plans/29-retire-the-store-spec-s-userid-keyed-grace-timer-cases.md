# Plan: Retire the store spec's userId-keyed grace-timer cases

## Context
`activity-session-store.service.spec.ts` still exercises the dead **userId-keyed** grace-timer trio (`startGraceTimer` / `cancelGraceTimer` / `hasPendingGraceTimer`). This test-only milestone retires those cases (rewriting the invariants worth keeping onto the live **sessionId-keyed** API), so the suite stays green and the downstream method deletion (`[[42-remove-userid-keyed-grace-trio]]`) won't orphan any case.

## Settings
- Testing: yes (this milestone is test maintenance on a single spec)
- Logging: none
- Docs: no

## Scope note (read before starting)

The milestone text enumerates `:226+`, `:257+`, `:288+` plus the constructor/`set()`/`delete()` cases — but the spec's **binding verify gate** is broader:

```
grep -nE '\.(startGraceTimer|cancelGraceTimer|hasPendingGraceTimer)\(' \
  src/realtime/services/activity-session-store.service.spec.ts | grep -v ForSession
→ zero matches
```

The current file uses the userId-keyed trio well past line 288 — in **Phase 9** (Promise/void semantics, `:318+`), **Phase 10** (concurrent independence between userIds, `:352+`), **Phase 11** (`cancelGraceTimer()`, `:406+`), and **Phase 12** (`hasPendingGraceTimer()`, `:455+`). All of these must also be removed or rewritten onto the `*ForSession` API, otherwise the gate fails and `[[42]]`'s method deletion would red the suite. Treat the gate as authoritative for scope.

**Confirm-before-drop rule (from the spec):** the live sessionId-keyed timer mechanism is already covered in `src/realtime/services/multi-session-lifecycle.spec.ts` (independence between `session-A`/`session-B`, expiry, post-expiry pending state). Before deleting a userId-keyed case, confirm its invariant is either (a) pure-mechanism coverage already provided there, or (b) re-expressed onto `*ForSession` in this file. Do **not** silently drop an invariant that has no sessionId-keyed equivalent — rewrite it instead.

**Out of scope — do not touch:** `get()`/`has()`/`set()`/`delete()`/`size` state cases, root/child accessors, or any non-grace-timer assertion. The `set()`/`delete()` *state* cases that do not reference a grace timer stay exactly as they are.

## Tasks

### Phase 1: Preserve invariants by rewriting onto the sessionId-keyed API

- [x] **Task 1: Re-express the constructor grace-period assertions through `startGraceTimerForSession`**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  In `describe('constructor')` (`:40-81`):
  - The default-30000ms case (`:41-51`) and the custom-`WS_RECONNECT_GRACE_MS` case (`:53-63`) currently fire via `startGraceTimer('user-1', cb)`. The `graceMs` field is shared by both timer APIs, so re-express both by calling `store.startGraceTimerForSession('session-1', cb)` instead — keep the `advanceTimersByTime` boundary assertions (29_999/+1 and 4_999/+1) identical. These config assertions **must survive**.
  - The post-construction case (`:77-80`) `hasPendingGraceTimer('any-user') === false` → rewrite to `hasPendingGraceTimerForSession('any-session')`.
  - Leave the `'should query ConfigService with the key "WS_RECONNECT_GRACE_MS"'` case (`:65-70`) and the `size === 0` case (`:72-75`) **unchanged** — they use no timer API.

- [x] **Task 2: Rewrite the `set()` / `delete()` "timers are independent of state" invariants onto the sessionId-keyed API**
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  These store-local invariants ("mutating state does not start/cancel a pending grace timer") are not duplicated in `multi-session-lifecycle.spec.ts`, so rewrite — do not delete:
  - `set()` case `:131-140` ("should not start, cancel, or otherwise affect a pending grace timer when set() is called") → use `startGraceTimerForSession`/`hasPendingGraceTimerForSession`.
  - `delete()` case `:162-172` ("should not cancel a pending grace timer when delete() is called") → same rewrite.
  - `delete()` case `:174-182` ("should leave hasPendingGraceTimer(otherUser) unchanged when delete(userA) is called") → rewrite onto two distinct sessionIds via the `*ForSession` API.
  Keep the surrounding `store.set(...)` / `store.delete(...)` state calls and their state assertions intact; only the timer calls change.

### Phase 2: Remove the dead userId-keyed mechanism describes

- [x] **Task 3: Delete the `startGraceTimer()` mechanism describes (Phases 6–8)** (depends on Task 1)
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Remove these blocks, which pin the dead userId-keyed mechanism:
  - Phase 6 — `describe('startGraceTimer() — happy path firing')` (`:226-253`). The grace-period config (default 30000, custom 5000) it asserts is already preserved by the rewritten constructor cases (Task 1); confirm that, then delete.
  - Phase 7 — `describe('startGraceTimer() — replacing an existing timer for the same userId')` (`:257-286`).
  - Phase 8 — `describe('startGraceTimer() — post-expiry cleanup')` (`:290-314`).
  For replace-semantics and post-expiry-cleanup: if no `*ForSession` equivalent exists in `multi-session-lifecycle.spec.ts`, rewrite the invariant onto `*ForSession` in this file instead of dropping it; otherwise delete.

- [x] **Task 4: Remove the remaining userId-keyed grace describes (Phases 9–12)** (depends on Task 3)
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  Clear all remaining non-`ForSession` grace usage so the verify gate reaches zero:
  - Phase 9 — `describe('startGraceTimer() — Promise-returning callback (void semantics)')` (`:318-348`).
  - Phase 10 — `describe('startGraceTimer() — concurrent independence between userIds')` (`:352-402`).
  - Phase 11 — `describe('cancelGraceTimer()')` (`:406-451`).
  - Phase 12 — `describe('hasPendingGraceTimer()')` (`:455-486`).
  Apply the confirm-before-drop rule: the independence/expiry mechanism is covered for sessionId timers in `multi-session-lifecycle.spec.ts`; the void/Promise semantics and `cancel`/`hasPending` no-op behaviors of the live API should already be (or be made) covered by `*ForSession` cases. Rewrite any invariant lacking a sessionId-keyed equivalent rather than dropping it.

### Phase 3: Verify

- [x] **Task 5: Confirm the gate passes** (depends on Task 4)
  Files: `src/realtime/services/activity-session-store.service.spec.ts`
  - Run `grep -nE '\.(startGraceTimer|cancelGraceTimer|hasPendingGraceTimer)\(' src/realtime/services/activity-session-store.service.spec.ts | grep -v ForSession` → must return **zero** matches.
  - Run `npx jest src/realtime/services/activity-session-store.service.spec.ts` → green, with the sessionId-keyed timer coverage and the grace-period config assertions (default 30000ms, custom `WS_RECONNECT_GRACE_MS`) still present.
  - Spot-check that no unrelated store case (`get`/`has`/`set`/`delete`/`size`, root/child accessors) was weakened.
