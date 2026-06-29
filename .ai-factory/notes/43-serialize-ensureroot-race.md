# Serialize ensureRoot per userId to close the duplicate-root race

**Date:** 2026-06-29
**Source:** conversation context (completed-work audit, race fix)

Code + test task. New task (from completed-work audit). No proto change, no migration.

## Defect — check-then-create TOCTOU
`ActivityEngine.ensureRoot(userId, clientTs?)` (`src/realtime/services/activity-engine.service.ts:73-118`):
```ts
const existingRootState = this.activitySessionStore.getRoot(userId);   // CHECK
if (existingRootState) { return reconstruct(rootId); }
const now = new Date();
const session = this.repo.create({ userId, activityType: ROOT, rootSessionId: null, ... });
const saved = await this.repo.save(session);                            // CREATE (awaits — yields)
this.activitySessionStore.setRoot(userId, saved.id, { ... });          // PUBLISH
return saved;
```
The `getRoot` check and the `setRoot` publish straddle an `await this.repo.save(...)`. Two near-simultaneous connects for one user (e.g. two devices, or a fast reconnect) both pass the `getRoot` check (the store is still empty), both `repo.create/save` a distinct root row, and the second `setRoot` **overwrites** the first in the store → the first root becomes an **orphaned, childless root row** in `module_sessions`, removed only later by the janitor ([[08-janitor-empty-roots]]).

## Fix — per-userId in-memory async lock
Serialize the critical section (store check → create → `setRoot`) per `userId` with a `Map<userId, Promise<ModuleSession>>` of the in-flight `ensureRoot`. A concurrent caller for the same `userId` **awaits the same in-flight promise** instead of creating a second root; the entry is cleared when it settles.
```ts
private readonly ensureRootInFlight = new Map<string, Promise<ModuleSession>>();

async ensureRoot(userId, clientTimestampMs?): Promise<ModuleSession> {
  const existing = this.activitySessionStore.getRoot(userId);
  if (existing) return this.reconstructRoot(userId, existing);   // fast path — no lock, no create

  const inflight = this.ensureRootInFlight.get(userId);
  if (inflight) return inflight;                                 // join the in-flight create

  const p = (async () => {
    const again = this.activitySessionStore.getRoot(userId);     // re-check inside the section
    if (again) return this.reconstructRoot(userId, again);
    const now = new Date();
    const session = this.repo.create({ userId, activityType: ActivityType.ROOT, status: SessionStatus.ACTIVE, startedAt: this.coerceClientTs(clientTimestampMs) ?? now, lastActivityAt: now, rootSessionId: null });
    const saved = await this.repo.save(session);
    this.activitySessionStore.setRoot(userId, saved.id, { sessionId: saved.id, activityType: ActivityType.ROOT, startedAt: saved.startedAt, lastActivityAt: saved.lastActivityAt, isPaused: false, rootSessionId: null });
    this.logger.log(`Root session created: userId=${userId} rootSessionId=${saved.id}`);
    return saved;
  })();
  this.ensureRootInFlight.set(userId, p);
  try { return await p; } finally { this.ensureRootInFlight.delete(userId); }
}
```
(`reconstructRoot` = the existing `existingRootState` branch that returns a `ModuleSession`-shaped object from the store state, `:78-90`; extract it or inline both spots.) Idempotent-by-userId behavior is preserved: concurrent callers resolve to the **same** root id and only **one** row is created; a caller arriving after the root exists takes the fast path (zero create).

## Scope / rationale (pin in the implementation)
- **In-memory, single-process lock** — correct for the single-instance in-memory realtime architecture (the session store is itself in-memory and process-local). The `Map` lives on the singleton `ActivityEngine`.
- **Do NOT add a DB unique index** on `(userId) WHERE activityType='root'`. Multiple roots per `userId` **over time** are legitimate — each app-open session is its own root / bio axis; a unique constraint would break a returning user's next session and conflict with the backfill ([[11-migration-backfill-roots]]) and janitor lifecycle. The race is about two *simultaneous* creates, not the historical multiplicity.
- The **janitor stays as-is** — it still sweeps orphaned childless roots from any other path; this fix just stops manufacturing them on concurrent connects.

## Inlined contracts (self-contained)
- `ActivityEngine` ctor: `(repo: Repository<ModuleSession>, activitySessionStore: ActivitySessionStore, eventEmitter, streamEngine)`.
- `activitySessionStore.getRoot(userId): ActivityState | undefined`, `getRootId(userId): string | undefined`, `setRoot(userId, sessionId, state)` (`activity-session-store.service.ts:65-81`).
- `repo.create(partial)` is synchronous; `repo.save(entity)` is async (the yield point).
- `ModuleSession` owner field is `.id` (uuid PK).

## Test (`activity-engine.service.spec.ts` — new cases)
Instantiate `ActivityEngine` with a mocked `Repository<ModuleSession>` (`create: jest.fn(e => e)`, `save: jest.fn().mockResolvedValue(makeRoot({ id: 'root-1' }))`) and a mocked/real `ActivitySessionStore` (`getRoot` returns `undefined` initially; `setRoot` a jest.fn).
- **Target — concurrent ensureRoot creates one root:** `const [a, b] = await Promise.all([engine.ensureRoot('u'), engine.ensureRoot('u')]);` → assert `repo.create` called **once**, `repo.save` called **once**, and `a.id === b.id === 'root-1'`. RED today (two creates). GREEN after the lock (the second call joins the in-flight promise before `save` settles, since `ensureRoot` runs synchronously up to its first `await`).
- **Characterization — idempotent when root exists:** with `getRoot` returning an existing root state, a single `ensureRoot('u')` does **zero** `repo.create` / `repo.save` and returns the existing root id. Stays GREEN (fast path unchanged).

## Verify
- The two new tests pass; the existing `ensureRoot` / root-lifecycle suites stay green.
- Manual: two rapid connects for one account create exactly one root row.

## Anti-targets
None — no committed test asserts the racy double-create. The new target is additive.

## Out of scope
Throwing on a "second root start" — the server cannot distinguish a second device from a reconnect; both correctly resolve to the one live root. Idempotent return is the intended contract and must stay (see [[34-deliver-root-id-on-connect]]).
