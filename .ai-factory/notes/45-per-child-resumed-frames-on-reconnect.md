# Emit a RESUMED session:state per live child on reconnect

**Date:** 2026-07-02
**Source:** conversation context (server feature request — reconnect fan-out)

Feature task. Tested by [[44-test-per-child-resumed-frames]] (lands first, TDD). No proto change, no migration.

## Problem — grounded precisely against HEAD
`ActivityEngine.handleReconnect(userId, clientSessionId?)` (`src/realtime/services/activity-engine.service.ts:604-654`) resumes **every** live session (root + all children) in a loop, but its return value collapses that work to a single `ModuleSession`:
```ts
// :616-639
let soleChildResult: ModuleSession | null = null;
let rootResult: ModuleSession | null = null;
for (const sid of sessionIds) {              // [rootId, ...childIds]
  this.activitySessionStore.cancelGraceTimerForSession(sid);
  const resumed = await this.resumeActivity(userId, sid);
  if (sid === rootId) { rootResult = resumed; }
  else { soleChildResult = resumed; }         // ← overwritten every non-root iteration
}
...
return soleChildResult ?? rootResult ?? null;
```
**Precise defect:** with **zero** children, `soleChildResult` stays `null` and `rootResult` (the resumed root) is returned — this path is already correct. With **N ≥ 1** children, `soleChildResult` is reassigned on every iteration, so the return value is whichever child happened to be iterated **last** (Map insertion order) — every other child was resumed in the DB/store (its `status`/`disconnectedAt`/`lastActivityAt` are correctly updated) but the client is told about none of them. This is silent: no error, no exception — the client simply never learns that child sessions other than the last-iterated one survived the reconnect.

The controller's reconnect block (`src/realtime/module-state.grpc.controller.ts`, `setup()` closure, resumed-session branch at `:168-182`) then emits exactly **one** `session:state` for that single `result`:
```ts
// :168-182 (unchanged by the zero-children fallback; see Decision below)
} else {
  subscriber.next({
    sessionState: {
      moduleSessionId: result.id,
      status: ActivityStatus.RESUMED,
      isPaused:
        this.activityEngine.getSession(userId, result.id)?.isPaused ?? false,
      activityType: mapInternalActivityType(result.activityType),
    },
  });
  this.logger.log(
    `Session resumed on reconnect: userId=${userId} sessionId=${result.id}`,
  );
}
```
This blocks the mobile client's pending-start reconciliation: a concurrent "tap-into-the-void" start it can't confirm after reconnect retries once its 10s idempotency window expires, producing a duplicate child.

## Decision — pinned design (narrow, minimal diff)
**Add a new enumerator delegate; do not widen `handleReconnect`'s return type; do not touch the zero-children fallback path.**

- `handleReconnect`'s contract (`Promise<ModuleSession | { abandoned: true } | null>`) is **unchanged**. It still drives the outer `if (result !== null)` / `'abandoned' in result` branching in the controller (the ABANDONED path and the no-op/null path are both untouched) and it still performs the actual DB/store resume work for every session (unchanged).
- Add a thin delegate **`ActivityEngine.listChildren(userId: string): ActivityState[]`** — `return this.activitySessionStore.listChildren(userId);` — inserted after `getRootId` (`activity-engine.service.ts:562-564`) and before `listLiveSessions` (`:566-570`), mirroring the exact one-line-forward pattern already used by `getSession` (`:554-556`), `getSoleChild` (`:558-560`), and `getRootId` itself. (`listLiveSessions`, which returns `[root, ...children]`, is **not** reused here — it conflates root and children, and the root-only fallback path below is deliberately left driving off `result`/`getSession`, unchanged.)
- In the controller's resumed-session branch, **branch on whether any children are live**:
  ```ts
  } else {
    const children = this.activityEngine.listChildren(userId);
    if (children.length > 0) {
      for (const child of children) {
        subscriber.next({
          sessionState: {
            moduleSessionId: child.sessionId,
            status: ActivityStatus.RESUMED,
            isPaused: child.isPaused,
            activityType: mapInternalActivityType(child.activityType),
          },
        });
      }
      this.logger.log(
        `Sessions resumed on reconnect: userId=${userId} count=${children.length}`,
      );
    } else {
      // Root-only fallback — UNCHANGED from today, byte-for-byte.
      subscriber.next({
        sessionState: {
          moduleSessionId: result.id,
          status: ActivityStatus.RESUMED,
          isPaused:
            this.activityEngine.getSession(userId, result.id)?.isPaused ?? false,
          activityType: mapInternalActivityType(result.activityType),
        },
      });
      this.logger.log(
        `Session resumed on reconnect: userId=${userId} sessionId=${result.id}`,
      );
    }
  }
  ```
- **Why this satisfies "preserve the root frame emission":** the root-only fallback (today's sole behavior when there are no children) is left as the exact same code, reached via the exact same condition (no live children) — nothing about it changes. The new per-child loop only activates when children exist, which today silently drops all-but-one of them; this is strictly additive information for the client, not a behavior change to the root path.
- **Why NOT also emit a root frame when children exist:** grounded against HEAD, today's code **never** emits a root frame when any child exists (the `??` always prefers `soleChildResult`) — so "preserve the root frame emission" is satisfied by leaving that already-narrow behavior alone, not by inventing a new "always announce root" contract. This also avoids re-opening the "no unsolicited root frame" design settled by [[34-deliver-root-id-on-connect]]/note 37 — the client already learns the root id from its own `activity:start { ROOT }` response and does not need it re-announced on every reconnect.
- Each child's `isPaused` is read directly off the `ActivityState` returned by `listChildren` (no per-child `getSession` round-trip needed — `listChildren` entries already carry `isPaused`). This is simpler than the fallback path's `getSession(...)?.isPaused ?? false` (kept there unchanged for the single root case, which has no children-list entry to read from).

## Inlined contracts (self-contained)
- `ActivityState` (`src/realtime/interfaces/activity-state.interface.ts`): `{ sessionId: string; activityType: ActivityType; activityRefId?: string; rootSessionId?: string | null; startedAt: Date; lastActivityAt: Date; isPaused: boolean }`. `isPaused` is a **required** boolean.
- `ActivityType` (internal, `src/realtime/enums/activity-type.enum.ts`): `BREATH = 'breath'`, `MEDITATION = 'meditation'`, `ROOT = 'root'`.
- `activitySessionStore.listChildren(userId): ActivityState[]` (`activity-session-store.service.ts:116-121`) — "Returns all children (excludes root)." Already used internally by `handleReconnect`/`handleTransportDisconnect` (`:610`, `:659`); this task adds the **public** one-line engine forward only.
- `mapInternalActivityType(internal: InternalActivityType): ProtoActivityType` (`module-state.grpc.controller.ts:75-92`) — `InternalActivityType` is `import { ActivityType as InternalActivityType } from './enums/activity-type.enum'`, i.e. the **same type** as `ActivityState.activityType` — no cast needed. Maps `BREATH→BREATH(1)`, `MEDITATION→MEDITATION(2)`, `ROOT→ROOT(3)`, default `ACTIVITY_TYPE_UNSPECIFIED(0)` (exhaustiveness-guarded, never hit for live sessions).
- `StateEvent` (proto, unchanged shape): `{ module_session_id, status, is_paused?, activity_type }` — already carries everything needed; no proto edit in this task.
- Controller ctor: `(activityEngine: ActivityEngine, rateLimiterService, activeStreamRegistry, configService, eventEmitter)` — no store dependency; `listChildren` is reached only through the new `ActivityEngine` delegate, consistent with the engine owning the store.

## Guards / gotchas
- Do **not** touch `handleReconnect`'s signature, its resume loop, or the `pushSessionEventMarker(rootId, RECONNECTED, ...)` call (`:631-637`) — all unchanged; the marker still fires once per reconnect regardless of child count.
- Do **not** add an `await` inside the per-child `for` loop — `subscriber.next` is synchronous, so the existing single `if (subscriber.closed) return;` guard (right before the `if (result !== null)` block, `:154`) remains sufficient; there is no yield point between frames where the subscriber could close mid-loop.
- Do **not** touch the ABANDONED branch (`:157-167`) or the `subscriber.closed`/no-op paths — this task only rewrites the resumed-session `else` branch.
- `listChildren` returning entries whose `activityType` is `ROOT` should not occur (the store's `listChildren` explicitly excludes root by design), but the mapping code makes no special assumption about it — if it ever happened, `mapInternalActivityType` would correctly map it to `ProtoActivityType.ROOT`.

## Cross-interactions
- **Committed test dependency:** [[44-test-per-child-resumed-frames]] must land first (TDD-first) — it adds the mandatory `listChildren: jest.fn().mockReturnValue([])` default to the shared `makeActivityEngine()` factory in `module-state.grpc.controller.spec.ts`, without which every reconnect-path test that reaches the resumed-session branch throws at runtime once this feature calls `this.activityEngine.listChildren(userId)` unconditionally.
- **Note 24 (pause-state integrity) — already landed, not a forward dependency.** The original request assumed note 24 was still parked below a durability `---STOP---` and would need to later reconcile its `isPaused` surfacing onto this feature's new per-child shape. **Verified against HEAD this is stale**: note 24 (`24-pause-state-integrity.md`) is committed (`[x]`, commit `3b455cc`) and its `getSession(...)?.isPaused ?? false` fix is already the code this task's root-only fallback path preserves unchanged (see §Problem). There is nothing left for note 24 to reconcile — **no flag needed to the human on that front**; this note simply builds on note 24's already-shipped surfacing mechanism in the fallback branch.

## Verify
- Reconnect with two live children (no root-only session) → two `session:state` RESUMED frames, one per child id, each with its own `activity_type` and `isPaused`.
- Reconnect with exactly one live child → one RESUMED frame for that child (via the new per-child loop, not the fallback).
- Reconnect with zero children (root only) → one RESUMED frame for the root — identical to today.
- Reconnect that resolves `{ abandoned: true }` → unchanged ABANDONED frame; `listChildren` not called.
- Mobile can now reconcile every concurrently-started child's survival after a reconnect, closing the duplicate-child retry gap.
