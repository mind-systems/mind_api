# Plan Review: 09 — Lazy root creation + child linking

**Plan:** `.ai-factory/plans/09-lazy-root-creation-child-linking.md`
**Scope reviewed:** ActivityEngine, ActivitySessionStore, ModuleSession entity, ModuleStateGrpcController, migrations, committed target/characterization tests.
**Risk Level:** 🔴 High — one task, as written, breaks protected characterization tests.

---

## Verified assumptions (correct)

- `ActivityType.ROOT = 'root'` exists (`enums/activity-type.enum.ts`). ✅
- `ModuleSession.rootSessionId: string | null` column exists, `@Index(['rootSessionId'])` present. ✅
- `ActivityState.rootSessionId?: string | null` exists. ✅
- Store API (`setRoot/getRoot/getRootId/removeRoot/addChild/getChild/getSession/getSoleChild/listChildren`) matches the code. ✅
- `endActivity(userId, clientTimestampMs?, sessionId?)` — `sessionId` is the **3rd** positional. ✅
- No-arg command paths resolve via `getSoleChild` (children-only), so they already never touch the root. ✅
- `coerceClientTs(...)` helper exists (lines 39–55). ✅
- **Migrations already exist and are correct** — no new migration required:
  - `1782658908789-AddRootActivityType.ts` → `ALTER TYPE … ADD VALUE IF NOT EXISTS 'root'`.
  - `1782658936664-AddRootSessionLink.ts` → adds `rootSessionId uuid`, self-FK with `ON DELETE CASCADE`, and `IDX_module_sessions_rootSessionId`.
  - The plan correctly does **not** schedule a migration. ✅

The target tests (block `target — ensureRoot / linking`, lines 701–854) were read in full and the plan's Task 1 idempotent/create branches satisfy the first test (`create exactly one root … reuse on repeat`) and the third (`never end the root via activity:end`).

---

## Critical Issues

### 1. Task 2 — calling `ensureRoot` at the top of `startActivity` will break protected characterization tests

The plan states (Task 2):
> At the top of `startActivity` (before `repo.create`), defensively `const root = await this.ensureRoot(userId);` so a child can never exist without a root.

This is unsafe. The committed **characterization** tests `start→end` (line 261) and `start→stop` (line 304) live in `describe('characterization — engine [GREEN now, must survive Phase 55]')`. The file header explicitly classifies any RED there as a **Class B silent regression — escalate, do NOT patch the test**.

These tests call `h.start('user-1', …)` against a **fresh store with no root seeded**, and queue exactly one save:

```ts
const session = makeSession();
repo.create.mockReturnValue(session);
repo.save.mockResolvedValueOnce(session); // startActivity save  ← only ONE queued
await h.start('user-1', { activityType: ActivityType.BREATH });
```

If `startActivity` first calls `ensureRoot(userId)`:
- `getRoot('user-1')` is `undefined` → **create branch** runs.
- It consumes `repo.create` once and the single `mockResolvedValueOnce(session)` for the root save.
- Control returns to `startActivity`, which calls `repo.create` again (returns `session`) then `repo.save(session)` — but the `once` queue is now exhausted, so the child save resolves to `undefined`.
- `const saved = await this.repo.save(...)` → `saved` is `undefined` → `state.sessionId = saved.id` throws `TypeError`. Test crashes.
- Even absent the crash, the store would now hold a spurious root entry, corrupting `store.has()` / `getSoleChild()` assertions in the follow-up `end`/`stop`.

**Fix:** Do not materialize a root inside `startActivity`. Link via a **read-only** store lookup instead:

```ts
const rootId = this.activitySessionStore.getRootId(userId); // null when no root — no DB access
```

Then use `rootId` for both the persisted row and the in-memory state. This satisfies the target test `should set a newly started child rootSessionId to the active root id` (which pre-seeds the root via `setRoot`, so `getRootId` returns `'root-session-1'`) **without** touching the DB in the no-root characterization tests (where `rootId` is `null`, and those tests don't assert on `rootSessionId`).

Root materialization belongs solely in the controller (Task 4), which already runs before any `activity:start` reaches the engine. The "defensive" engine-side call adds nothing in production and breaks the unit contract.

---

## Important Issues

### 2. Task 2 — adding `rootSessionId` only to the `repo.create({…})` argument will NOT make the linking test green

The target test mocks `repo.create` to return a **fixed** `childRow` (with `rootSessionId: null`) and inspects the object passed to `save`:

```ts
repo.create.mockReturnValue(childRow);   // childRow.rootSessionId === null
repo.save.mockResolvedValue(childRow);
await engine.startActivity('user-1', { activityType: ActivityType.BREATH });
const savedChild = repo.save.mock.calls[0][0] as any;
expect(savedChild.rootSessionId).toBe('root-session-1');
```

Because `repo.create` is mocked, the field placed in the `create({…})` argument never reaches the returned entity — `save` receives `childRow`, whose `rootSessionId` is `null`. The plan's instruction ("Add `rootSessionId: root.id` to the `repo.create({...})` object") alone therefore leaves the assertion failing.

**Fix:** Assign the field onto the entity instance after `create`, e.g.:

```ts
const session = this.repo.create({ … });
session.rootSessionId = rootId;   // mutate so the saved object carries it
```

The in-memory `ActivityState` literal is fine as the plan describes it (it is built fresh in the implementation, not mocked), so `storedState.rootSessionId` will be correct via the literal — only the persisted-row path needs the explicit assignment.

---

## Minor Notes

- **Task 1 idempotent branch** — returning a synthesized `ModuleSession`-shaped object with `id: getRootId(userId)` and zero `repo.create`/`repo.save` matches the second assertion of the first target test (`second.id === first.id`, no additional save). Correct. Keep the single `logger.log` on the create path only, per "Logging: minimal".
- **Task 3 guard** — defensive and harmless; no committed test exercises an explicit-`sessionId`-addresses-root call, but the guard does not interfere with the no-arg paths (which resolve via `getSoleChild` and never see the root). The null-return / throw contracts chosen per method match existing behavior. Fine.
- **Task 4 controller** — placing `await this.activityEngine.ensureRoot(userId)` after the `handleReconnect` block, guarded by `if (subscriber.closed) return;`, is correct. Note there is already a `subscriber.closed` guard at line 114; a second one immediately before `ensureRoot` is reasonable since `ensureRoot` is `await`ed (a disconnect could land in between). On reconnect-within-grace, `handleReconnect` resumes the existing root, so `ensureRoot` hits its idempotent zero-write branch — no duplicate. ✅
- `handleActivityStart`'s `getActiveSession` uses `getSoleChild` (children-only), so a materialized root does not block new `activity:start`. ✅

---

## Required changes before implementation

1. **Task 2 (critical):** Replace "call `ensureRoot` at the top of `startActivity`" with a read-only `getRootId(userId)` lookup. Do not invoke `ensureRoot` from inside `startActivity`.
2. **Task 2 (important):** Set `rootSessionId` on the created entity instance (assignment after `repo.create`), not only inside the `create({…})` argument, so the mocked-create return carries it for the `save` assertion.

Both are localized to `startActivity` in Task 2; Tasks 1, 3, and 4 are sound as written.
