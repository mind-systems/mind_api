# Plan: Serialize `ensureRoot` per userId to close the duplicate-root race

## Context
Close the check-then-create TOCTOU in `ActivityEngine.ensureRoot` by serializing the store-check → create → `setRoot` section per `userId` with an in-memory in-flight promise map, so two near-simultaneous connects for one user resolve to the same single root row instead of creating an orphaned second root.

## Settings
- Testing: yes (milestone specifies a target test + characterization test)
- Logging: minimal (preserve existing `Root session created` log; no new logs)
- Docs: no

## Tasks

### Phase 1: Implementation

- [x] **Task 1: Extract the existing-root fast path into a private `reconstructRoot` helper**
  Files: `src/realtime/services/activity-engine.service.ts`
  Add a private **synchronous** method `reconstructRoot(userId: string, state: ActivityState): ModuleSession | null` that returns the synthesized root `ModuleSession` currently built inline in the `existingRootState` branch (`:78-90`). Resolve the root id **without** the non-null assertion operator (`!`) — RULES.md forbids `!`: read `const rootId = this.activitySessionStore.getRootId(userId); if (!rootId) return null;`. The `null` return is the defensive branch for a missing id (effectively dead code, since `setRoot` writes `rootSessionId` and `root` atomically, but it keeps the helper from synthesizing an object with a `null`/`undefined` id). Per Finding 1, the helper itself does **not** create a root — the create fall-through is the caller's responsibility (Task 2). When `rootId` is present, the synthesized object keeps the exact same shape/fields as today: `id: rootId, userId, activityType: ActivityType.ROOT, activityRefId: undefined, rootSessionId: null, status: SessionStatus.ACTIVE, startedAt: state.startedAt, lastActivityAt: state.lastActivityAt` cast `as ModuleSession`.

- [x] **Task 2: Add the per-userId in-flight lock and rewrite `ensureRoot` to use it** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.ts`
  Add a private field `private readonly ensureRootInFlight = new Map<string, Promise<ModuleSession>>();`. Rewrite `ensureRoot(userId, clientTimestampMs?)`:
  1. Fast path: `const existing = this.activitySessionStore.getRoot(userId);` then `if (existing) { const r = this.reconstructRoot(userId, existing); if (r) return r; }` — no lock, no create. Because `reconstructRoot` can return `null` (Finding 1), guard on the result and only fall through to the create path when it is `null`; do not `return` a `null`.
  2. Join path: `const inflight = this.ensureRootInFlight.get(userId); if (inflight) return inflight;` — a concurrent caller for the same user awaits the same promise.
  3. Critical section: build the in-flight promise `p = (async () => { ... })()` that re-checks the store (`getRoot` again → `reconstructRoot`, returning it only if non-`null`), then does the existing `repo.create` / `await this.repo.save` / `setRoot` / `this.logger.log('Root session created: ...')` sequence and returns `saved`. Set `this.ensureRootInFlight.set(userId, p)` synchronously before the first `await`, then `try { return await p; } finally { this.ensureRootInFlight.delete(userId); }`.
  Preserve all current field values for `repo.create` (`startedAt: this.coerceClientTs(clientTimestampMs) ?? now`, `lastActivityAt: now`, `rootSessionId: null`, etc.) and the existing `setRoot` payload. Do **not** add a DB unique index or migration — multiple roots per user over time are legitimate; this lock only collapses *simultaneous* creates. Janitor is untouched.

### Phase 2: Tests

- [x] **Task 3: Add target + characterization tests for the concurrent-create race** (depends on Task 2)
  Files: `src/realtime/services/activity-engine.service.spec.ts`
  Reuse the existing `makeRepo` / `makeActivitySessionStore` / `makeEmitter` / `makeStreamEngine` helpers and the `new ActivityEngine(repo, store, emitter, streamEngine)` construction pattern already in the file.
  - **Target — concurrent `ensureRoot` creates one root:** configure `repo.create` as `jest.fn((e) => e)` and `repo.save` as `jest.fn().mockResolvedValue(makeSession({ id: 'root-1', activityType: ActivityType.ROOT, rootSessionId: null }))`, with the store's `getRoot` returning `undefined` initially. Run `const [a, b] = await Promise.all([engine.ensureRoot('u'), engine.ensureRoot('u')]);` and assert **`repo.create` called once and `repo.save` called once** — these call-count assertions are the primary RED→GREEN discriminator (pre-lock: twice). Also assert `a.id === b.id` and equals `'root-1'`, but treat this as secondary only: per Finding 3, since both `save` calls resolve to the same mock, id-equality holds even in the RED state, so it cannot stand alone. (RED before the lock — two creates; GREEN after, since the second call joins the in-flight promise before `save` settles.)
  - **Characterization — idempotent when a root already exists:** pre-seed the store via the **real store's** `setRoot('u', '<root-id>', state)` so that both `getRoot('u')` and `getRootId('u')` return consistently (per Finding 2 — do **not** stub only `getRoot`, or the `reconstructRoot` falsy-`rootId` guard sends it down the create path and the zero-create assertion fails). Then call `ensureRoot('u')` once and assert zero `repo.create` / zero `repo.save` calls and that the returned `id` equals the seeded root id. (Stays GREEN — fast path unchanged.)

## Commit Plan
- **Commit 1** (after tasks 1-2): "Serialize ensureRoot per userId to prevent duplicate root creation"
- **Commit 2** (after task 3): "Add tests for concurrent ensureRoot single-root guarantee"
