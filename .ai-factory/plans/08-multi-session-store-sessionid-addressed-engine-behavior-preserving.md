# Plan: Multi-session store + sessionId-addressed engine (behavior-preserving)

## Context
Restructure `ActivitySessionStore` from one slot per user (`Map<userId, ActivityState>`) into a per-user multi-session model (`Map<userId, {rootSessionId, children: Map<sessionId, ActivityState>}>`) with grace timers also keyable by `sessionId`, and thread an explicit, **optional** `sessionId` through the `ActivityEngine` lifecycle methods. Pure refactor — external behavior stays identical: there is still exactly one live child per user in practice (roots are not created until the next phase, concurrency is not used yet), and the controller keeps calling the engine with `userId` only, so the engine resolves the single live child internally.

## Settings
- Testing: no (do not author tests; the committed specs are the contract — keep them green)
- Logging: minimal
- Docs: no

## ⚠️ The committed test contract (read first — this drives every signature decision)
Four committed spec files exercise the exact code this plan changes. **All four must stay GREEN with ZERO edits** (no assertion edits, no helper-body edits, no `.skip`):

1. `src/realtime/services/activity-session-store.service.spec.ts` — calls the **userId-keyed grace trio** `startGraceTimer` / `cancelGraceTimer` / `hasPendingGraceTimer` 82×, plus `set/get/has/delete` and the `size` getter.
2. `src/realtime/services/activity-engine.service.spec.ts` — calls **single-arg** `onDisconnect('user-1')` and asserts it is a **no-op (`repo.update` NOT called) when no session is stored**; asserts the disconnected entry **survives in the store**.
3. `src/realtime/services/multi-session-lifecycle.spec.ts` — characterization (must survive) + the multi-session/engine `target` blocks (flip GREEN) + the `ensureRoot / linking` target block (**stays RED — next phase, do NOT implement roots here**). The `coerceClientTs Long branch on endActivity` characterization (≈ line 536) calls `engine.endActivity('user-1', longLike)` expecting the **2nd positional arg to be the timestamp**.
4. `src/realtime/module-state.grpc.controller.spec.ts` — freezes the **exact** engine call shapes: `endActivity('user-1', undefined)` (`:783`), `stopActivity('user-1')` (`:835`, `:569`), `pauseActivity('user-1')` (`:891`), `unpauseActivity('user-1')` (`:957`). Jest's `toHaveBeenCalledWith('user-1')` does **not** tolerate a trailing extra arg.

**The forcing rule that makes all four pass with zero edits:** every new `sessionId` parameter is **optional and appended in a position that never displaces an existing positional arg**. When `sessionId` is omitted the engine resolves the target via `store.getSoleChild(userId)?.sessionId` (children-only). Because the controller and the spec helpers keep calling with `userId` only, every frozen call shape is preserved.

### Deviations from spec note `03-multi-session-store-engine.md` (the note predates these committed specs and conflicts with them)
- **`endActivity` parameter order.** The note's GAP-03-B says `endActivity(userId, sessionId?, clientTimestampMs?)`. That inserts `sessionId` **before** the existing `clientTimestampMs`, which breaks the characterization Long-branch test and the controller `endActivity('user-1', undefined)` assertion. **Override:** keep `clientTimestampMs` as the 2nd positional and append `sessionId` **last** → `endActivity(userId, clientTimestampMs?, sessionId?)`. The "optional 2nd positional" rule applies only to the no-other-arg methods (`stop/pause/unpause/resume/abandon`).
- **`onDisconnect` requiredness.** The note says make `sessionId` **required** and drop the guard. That breaks the single-arg `onDisconnect('user-1')` test and the "no-op when no session" test. **Override:** `sessionId` is **optional** with sole-child resolution, and the early-return guard stays.
- **Removing the userId-keyed grace trio.** The note says delete `startGraceTimer/cancelGraceTimer/hasPendingGraceTimer`. The store spec calls them 82×. **Override:** keep the trio; only the *engine callers* move onto the `…ForSession` variants.
- **Controller `sessionId` threading + revoke fan-out.** The note rewrites controller call sites and loops `handleSessionRevoked` over root+children. Both break the frozen controller spec, and the controller has no `ActivitySessionStore` injected (it cannot enumerate root+children without violating the thin-controller boundary). **Override:** leave the controller call sites unchanged and **defer** the revoke fan-out to the later phase (`06-state-controller-concurrent-idempotency`, when the controller spec is updated and an engine-level fan-out method exists).

These overrides preserve the note's actual goal (multi-session store + internal sessionId addressing) while honoring the committed tests the note never reconciled.

## Standing constraints
- This is **one atomic compile unit / one reason to revert** — store, engine, and any caller changes land together. No intermediate task compiles independently. See Commit Plan.
- Keep `graceMs` resolution, the `WS_RECONNECT_GRACE_MS` config key, and `DEFAULT_GRACE_MS = 30_000` unchanged.
- Do NOT create roots here. `UserSessions.rootSessionId` exists but stays `null`; `getRoot` returns `undefined` until lazy-root-creation lands. `ActivityState.rootSessionId` already exists on the interface — no interface change needed.
- Preserve every existing event emit, stream push, status transition, and guard (e.g. the `abandonActivity` "already ACTIVE → skip" guard) unchanged.
- Keep the `repo.findOne({ where: { id: sessionId } })` and positional `repo.update(sessionId, {...})` call shapes exactly (the multi-session target stubs dispatch on these shapes).

## Tasks

### Phase 1: Store restructure

- [x] **Task 1: Restructure `ActivitySessionStore` to the per-user multi-session shape**
  Files: `src/realtime/services/activity-session-store.service.ts`
  - Add a `UserSessions` interface: `{ rootSessionId: string | null; children: Map<string, ActivityState>; root?: ActivityState }` — the root state lives in its own slot, NOT inside `children`.
  - Replace `activityMap = new Map<string, ActivityState>()` with `private readonly activityMap = new Map<string, UserSessions>()`.
  - **Grace timers — keep ONE `timers: Map<string, handle>` map and BOTH key families over it:**
    - **Keep** the existing userId-keyed `startGraceTimer(userId, onExpiry)` / `cancelGraceTimer(userId)` / `hasPendingGraceTimer(userId)` exactly as today (store spec depends on them — C1).
    - **Add** `startGraceTimerForSession(sessionId, onExpiry)` / `cancelGraceTimerForSession(sessionId)` / `hasPendingGraceTimerForSession(sessionId)` with identical semantics keyed by `sessionId`. (userId and sessionId key spaces are disjoint in practice; the engine uses only the `…ForSession` family, the store spec uses only the userId family.)
  - **New multi-session methods:**
    - `setRoot(userId, sessionId, state?)` — set `rootSessionId = sessionId` and `root = state` on the user bucket (create the bucket if absent).
    - `getRoot(userId): ActivityState | undefined` — the root slot's state.
    - `getRootId(userId): string | null` — `rootSessionId` or `null`.
    - `removeRoot(userId): boolean` — clear the root slot (`rootSessionId = null`, `root = undefined`); return whether one was cleared; **prune the bucket if it then has no root and no children** (M3).
    - `addChild(userId, sessionId, state)` — add to `children` (create bucket if absent).
    - `getChild(userId, sessionId): ActivityState | undefined`.
    - `getSession(userId, sessionId): ActivityState | undefined` — child-or-root lookup: `getChild(...) ?? (getRootId(userId) === sessionId ? getRoot(userId) : undefined)`. Used by the fan-out resume/abandon paths so they can resolve a seeded root state.
    - `listChildren(userId): ActivityState[]` — children only (excludes root).
    - `removeChild(userId, sessionId): boolean` — delete from `children`; **prune the bucket if it then has no root and no children** (M2).
    - `getSoleChild(userId): ActivityState | undefined` — the single live child (children-only; excludes root).
  - **Legacy sole-child shims (children-only, GAP-03-A) — keep `set/get/has/delete`:**
    - `set(userId, state)` → reset `children` to a single entry `{ [state.sessionId]: state }` (does not touch the root slot).
    - `get(userId)` → `getSoleChild(userId)`.
    - `has(userId)` → `true` iff ≥1 child.
    - `delete(userId)` → remove the sole child, return `boolean`, **prune the empty bucket** so `size` decrements (M2).
  - **`get size`** → `this.activityMap.size` (number of user buckets with state). Because every shim/removal prunes empty buckets, the store-spec `size` cases (set user-1, set user-2 → 2; delete user-1 → 1; overwrite → unchanged) stay green (M2).

### Phase 2: Engine — internal sessionId resolution (all `sessionId` params OPTIONAL)

- [x] **Task 2: Thread optional `sessionId` through terminal + pause/resume methods** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.ts`
  - Signatures (append-only, backward-compatible):
    - `endActivity(userId, clientTimestampMs?, sessionId?)` — **`sessionId` LAST** (C3).
    - `stopActivity(userId, sessionId?)`, `pauseActivity(userId, sessionId?)`, `unpauseActivity(userId, sessionId?)`, `resumeActivity(userId, sessionId?)`, `abandonActivity(userId, sessionId?)`.
  - In each: `const sid = sessionId ?? this.activitySessionStore.getSoleChild(userId)?.sessionId;` if `sid` is undefined, keep today's no-session handling (`return null` / no-op / `throw NO_ACTIVE_SESSION`). Resolve the in-memory state via `store.getSession(userId, sid)` (so a seeded root resolves too) instead of `store.get(userId)`.
  - Store mutations: `startActivity` writes via `store.addChild(userId, saved.id, state)`. Terminal states (`endActivity`/`stopActivity`/`abandonActivity`) clear via `store.removeChild(userId, sid)`; if `sid === store.getRootId(userId)` use `store.removeRoot(userId)` instead (dormant this phase, but correct).
  - `resumeActivity` keeps `repo.findOne({ where: { id: sid } })`; on miss, clear via removeChild/removeRoot as above.
  - `getActiveSession(userId)` stays; now returns `store.getSoleChild(userId)`.
  - Preserve all event emits, stream pushes, status transitions, and the abandon ACTIVE-guard exactly.

- [x] **Task 3: `onDisconnect` (optional sessionId) + disconnect/reconnect fan-out** (depends on Task 2)
  Files: `src/realtime/services/activity-engine.service.ts`
  - `onDisconnect(userId, sessionId?)` — resolve `const sid = sessionId ?? store.getSoleChild(userId)?.sessionId;` **early-return if `sid` is undefined** (preserves the "no-op when no session" test, C2). Then `await repo.update(sid, { status: DISCONNECTED, disconnectedAt: now })` (positional shape). Does NOT remove the store entry and does NOT start a timer (preserves the single-arg "kept in store, no emit" test).
  - `handleTransportDisconnect(userId)` — enumerate every live session id: `[store.getRootId(userId), ...store.listChildren(userId).map(c => c.sessionId)]`, filtered to truthy. For each `sid`: `await this.onDisconnect(userId, sid)`, then `store.startGraceTimerForSession(sid, () => this.abandonActivity(userId, sid).catch(...))`. (Single-child case: list is `[childSid]` → identical to today's behavior.)
  - `handleReconnect(userId, clientSessionId?)` — build the same id list; gate on **`store.getRootId(userId) || store.listChildren(userId).length > 0`** (N1 — not legacy `has()`, which would skip a root-only user). If non-empty: for each `sid` → `store.cancelGraceTimerForSession(sid)` then `await this.resumeActivity(userId, sid)`; return the resumed sole-child result if present, else the resumed root result, else `null`. If the id list is empty, keep the existing `clientSessionId` ABANDONED-confirmation branch unchanged. Return type stays `Promise<ModuleSession | { abandoned: true } | null>` so the controller `setup()` handling is unaffected.

- [x] **Task 4: `abandonStale` — child/root store cleanup** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.ts`
  - Signature unchanged: `abandonStale(userId, sessionId)`.
  - Replace internal `store.get(userId)` / `store.delete(userId)` with targeted lookups/removal: resolve via `store.getSession(userId, sessionId)`; on terminal cleanup, if `sessionId === store.getRootId(userId)` (or the row's `activityType === ActivityType.ROOT`) use `store.removeRoot(userId)`, otherwise `store.removeChild(userId, sessionId)`. (Root branch is dormant until roots exist but must be correct now, since the watchdog sweep will return root rows later.)

### Phase 3: Callers — confirm no change needed

- [x] **Task 5: Verify callers compile and stay behavior-identical (no code changes expected)** (depends on Tasks 2–4)
  Files: `src/realtime/module-state.grpc.controller.ts`, `src/realtime/services/session-watchdog.service.ts`
  - **Controller — leave call sites unchanged (C4/C5):** `endActivity(userId, clientTimestampMs)`, `stopActivity(userId)`, `pauseActivity(userId)`, `unpauseActivity(userId)`, `getActiveSession(userId)` guard, and `handleSessionRevoked` → `stopActivity(payload.userId)` all stay exactly as today. Internal sole-child resolution keeps behavior identical (one live child in practice). The revoke fan-out over root+children is **deferred** to the later concurrent-idempotency phase.
  - **Watchdog — no change (N2):** `session-watchdog.service.ts:82` already calls `abandonStale(row.userId, row.id)` with an explicit `sessionId`; the behavior change is entirely inside Task 4's engine internals. Touch only if a compile error surfaces.

## Verify
- `npm run build` is clean.
- `npm test` passes with **zero test-file edits**, specifically:
  - `activity-session-store.service.spec.ts` GREEN (userId-keyed grace trio + `size` + `set/get/has/delete` intact).
  - `activity-engine.service.spec.ts` GREEN (single-arg `onDisconnect`, no-op guard, store-entry-survives, `endActivity('user-1', ts)` ordering).
  - `module-state.grpc.controller.spec.ts` GREEN (frozen `endActivity('user-1', undefined)` / `stopActivity('user-1')` / `pauseActivity('user-1')` / `unpauseActivity('user-1')` / revoke single-arg shapes).
  - `multi-session-lifecycle.spec.ts`: all `characterization — *` GREEN; `target — multi-session store` and `target — engine multi-session` turn GREEN; `ensureRoot / linking` target block stays RED (expected — next phase).
- No `store.get(userId)`-as-singleton resolution remains in the engine lifecycle paths (resolution goes through `getSoleChild` / `getSession` / `getChild`).
- No grace-timer leak: per-session timers are cleared on cancel/fire.

## Commit Plan
- **Commit 1** (after Tasks 1–5): "Restructure activity session store to per-user multi-session model with sessionId-addressed engine"
  - Single commit by design — one atomic compile unit (one reason to revert): keeping the userId-keyed grace trio while adding the `…ForSession` family, threading optional `sessionId` through the engine, and pruning empty store buckets must land together. Commit only after the full build + `npm test` verify passes, and only with explicit user permission.
