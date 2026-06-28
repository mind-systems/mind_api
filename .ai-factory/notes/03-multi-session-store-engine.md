# Multi-session store + engine refactor (behavior-preserving)

**Date:** 2026-06-28
**Source:** conversation context

## Decisions (locked)
- On `SESSION_REVOKED` (auth logout/token revoke), `handleSessionRevoked` stops **all** the user's children **and** the root (revoke ends the whole "app open" container), then `closeAll(userId)`. Resolves note 16 F-07.

## Key Findings

- The hard structural keystone: `ActivitySessionStore` is `Map<userId, ActivityState>` — physically one session slot per user. Every `ActivityEngine` method resolves "the" session by `userId`. This must become per-user multi-session, with grace timers keyed by `sessionId`.
- This task is a **pure refactor**: external behavior stays identical (still one active child in practice). It only restructures the in-memory model and threads `sessionId` through the engine API. Concurrency becomes *possible* but is not yet *used* (that is [[06-state-controller-concurrent-idempotency]]).
- Cannot be split smaller: store, engine, and every caller compile together — one reason to revert.

## Details

### Current state (exact)
- `src/realtime/services/activity-session-store.service.ts`:
  - `activityMap = new Map<string, ActivityState>()` (line 9, keyed by userId), `timers = new Map<string, ReturnType<typeof setTimeout>>()` (line 10, keyed by userId).
  - `graceMs` resolved in ctor (lines 13-17) from `WS_RECONNECT_GRACE_MS`, default `DEFAULT_GRACE_MS = 30_000` (line 5). **Keep this exact key + default.**
  - Methods: `get(userId)` (19), `has(userId)` (23), `set(userId, state)` (27), `delete(userId)` (31), `get size` (35), `startGraceTimer(userId, onExpiry)` (39), `cancelGraceTimer(userId)` (48), `hasPendingGraceTimer(userId)` (55).
- `src/realtime/services/activity-engine.service.ts` — all resolve "the" session via `store.get(userId)`:
  - `coerceClientTs(...)` (39-55), `startActivity(userId, dto)` (57-96, calls `store.set(userId, state)` at 81), `endActivity(userId, clientTimestampMs?)` (98-167), `onDisconnect(userId)` (169-182), `abandonActivity(userId)` (184-227), `abandonStale(userId, sessionId)` (229-281, already sessionId-scoped), `stopActivity(userId)` (283-335), `pauseActivity(userId)` (337-367), `unpauseActivity(userId)` (369-399), `getActiveSession(userId)` (401-403), `resumeActivity(userId)` (405-429), `handleReconnect(userId, clientSessionId?)` (431-451), `handleTransportDisconnect(userId)` (453-465).
  - `handleReconnect` currently: `if (store.has(userId)) { store.cancelGraceTimer(userId); return resumeActivity(userId); }` (435-438), else the `clientSessionId` ABANDONED-confirmation branch (439-449).
  - `handleTransportDisconnect` currently: `await onDisconnect(userId); if (store.has(userId)) store.startGraceTimer(userId, () => abandonActivity(userId)...)` (453-465).
- Callers (exact file:line):
  - `module-state.grpc.controller.ts`: `getActiveSession(payload.userId)` in `handleSessionRevoked` (line 201); `stopActivity(payload.userId)` (203); `handleReconnect(userId, clientSessionId)` in `setup()` (110-113); `getActiveSession(userId)` in `handleActivityStart` (281); `startActivity` (306); `endActivity(userId, clientTimestampMs)` (327); `stopActivity(userId)` (345); `pauseActivity(userId)` (363); `unpauseActivity(userId)` (388); `handleTransportDisconnect(userId)` in teardown (185).
  - `session-watchdog.service.ts`: `abandonStale(row.userId, row.id)` (line 82), followed by `activeStreamRegistry.closeAll(row.userId)` (83).

### Change — store shape (replaces `Map<userId, ActivityState>`)
Per note 16 F-05, `activityMap` becomes `Map<userId, UserSessions>`:
```ts
interface UserSessions {
  rootSessionId: string | null;        // the user's root session id, or null until ensureRoot ([[04-lazy-root-creation]])
  children: Map<string, ActivityState>; // keyed by sessionId (children only — root not in this map)
}
```
Grace timers re-keyed: `timers: Map<string, ReturnType<typeof setTimeout>>` becomes **keyed by sessionId, not userId** (F-04).

**Upstream contracts (inlined — self-contained).** This task's code touches two symbols introduced by [[02-root-session-schema]], which already exist as real code by now (links are breadcrumbs only):
- `ActivityState` shape (`src/realtime/interfaces/activity-state.interface.ts`): `{ sessionId: string; activityType: ActivityType; activityRefId?: string; startedAt: Date; lastActivityAt: Date; isPaused: boolean; rootSessionId?: string | null }` — the `children` map and root slot store values of this type.
- `ActivityType.ROOT = 'root'` (`src/realtime/enums/activity-type.enum.ts`) — the discriminator the watchdog/`abandonStale` guard uses to tell a stale **root** row (clean up via the root slot) from a child (`removeChild`).

**Legacy method compatibility shims (GAP-03-A — committed characterization depends on these).** `set/get/has/delete` MUST survive on the new `Map<userId, UserSessions>` shape with **sole-child** semantics so the committed `characterization` block (which seeds via `store.set(...)` and asserts `store.has(...) === false` after terminal transitions, and the round-trip case `multi-session-lifecycle.spec.ts:135-144`) stays GREEN with **zero test edits**. They resolve over the **children map ONLY — never the root**:
- `set(userId, state)` → store `state` as the **sole child** keyed by `state.sessionId` (reset `children` to a single entry `{ [state.sessionId]: state }`). Does not touch the root slot.
- `get(userId)` → return the **sole child** (`= getSoleChild(userId)`); `undefined` if none. Children-only — excludes the root.
- `has(userId)` → `true` iff the user has at least one child.
- `delete(userId)` → remove the sole child; return `true` if one was removed (preserve today's `boolean` contract). Does not delete the root slot.

New store method signatures (exact — from F-04/F-05). Keep `graceMs` / `WS_RECONNECT_GRACE_MS` / `DEFAULT_GRACE_MS = 30_000` unchanged:
```ts
// children + root (F-05)
setRoot(userId: string, sessionId: string, state?: ActivityState): void;
getRoot(userId: string): ActivityState | undefined;       // returns root state if tracked, else undefined
getRootId(userId: string): string | null;                 // convenience: UserSessions.rootSessionId
addChild(userId: string, sessionId: string, state: ActivityState): void;
getChild(userId: string, sessionId: string): ActivityState | undefined;
listChildren(userId: string): ActivityState[];            // children only
removeChild(userId: string, sessionId: string): boolean;
getSoleChild(userId: string): ActivityState | undefined;  // the single live child; replaces today's get(userId)
// per-session grace timers (F-04) — replace the userId-keyed trio
startGraceTimerForSession(sessionId: string, onExpiry: () => void | Promise<void>): void;
cancelGraceTimerForSession(sessionId: string): void;
hasPendingGraceTimerForSession(sessionId: string): boolean;
```
Remove the userId-keyed `startGraceTimer`/`cancelGraceTimer`/`hasPendingGraceTimer` (current lines 39-57) once all callers are migrated — they MUST be updated atomically in this same task (single compile unit; see Key Findings).

### Change — engine signatures (thread `sessionId` — OPTIONAL 2nd positional, GAP-03-B)
Per F-01/F-02/F-06, engine methods accept an explicit `sessionId` as an **OPTIONAL** 2nd positional arg. **Optional, not required** — this keeps the committed `characterization` block + the `endActivity('user-1')` root-skip case GREEN with **zero test edits** (the spec's `makeHelpers` wrappers and the direct calls at `multi-session-lifecycle.spec.ts:109,110,114,115,492,836` still pass only `userId`):
```ts
endActivity(userId: string, sessionId?: string, clientTimestampMs?: number): Promise<ModuleSession | null>;
stopActivity(userId: string, sessionId?: string): Promise<ModuleSession | null>;
pauseActivity(userId: string, sessionId?: string): ActivityState;
unpauseActivity(userId: string, sessionId?: string): ActivityState;
resumeActivity(userId: string, sessionId?: string): Promise<ModuleSession | null>;
onDisconnect(userId: string, sessionId: string): Promise<void>;     // pure "mark DISCONNECTED" only (F-03); always invoked per-session by the fan-out loop, so sessionId is required here
abandonActivity(userId: string, sessionId?: string): Promise<void>;  // grace-timer callback target (F-06)
abandonStale(userId: string, sessionId: string): Promise<void>;     // signature unchanged; lookups switch to child/root maps (F-07)
getActiveSession(userId: string): ActivityState | undefined;        // keep — returns getSoleChild(userId)
```
- **Sole-child fallback (GAP-03-B):** when `sessionId` is omitted, each method resolves the target via `const sid = sessionId ?? store.getSoleChild(userId)?.sessionId`. `getSoleChild` reads the **children map ONLY** (excludes the root), so the no-`sessionId` path can never address the root — this is what preserves the root-skip guarantee in [[04-lazy-root-creation]] for the committed `endActivity('user-1')` test. If `sid` is still undefined → existing no-session handling (`return null` / no-op), matching engine lines 102-108.
- Each method then resolves its `ActivityState` via `store.getChild(userId, sid)`, NOT `store.get(userId)`. Store mutations: `startActivity` uses `addChild`; terminal states (`endActivity`/`stopActivity`/`abandonActivity`/`abandonStale`) use `removeChild(userId, sid)` instead of `delete(userId)`.
- **Repo call-shape preservation (GAP-03-C):** per-session `resumeActivity(userId, sessionId)` MUST keep issuing `repo.findOne({ where: { id: sessionId } })` (today's shape at engine line 409) — the committed reconnect-fan-out stub dispatches on `({ where: { id } })` (`multi-session-lifecycle.spec.ts:662-669`). Do NOT switch to a `findOne(sessionId)` shorthand. Likewise `onDisconnect` keeps the **positional** `repo.update(sessionId, { status, disconnectedAt })` shape (engine line 174; asserted positionally at `multi-session-lifecycle.spec.ts:354`).

### Change — disconnect fan-out (F-01)
`handleTransportDisconnect(userId)` must iterate **all** of the user's live sessions (root + every child) and for EACH:
1. `await onDisconnect(userId, sessionId)` → `repo.update(sessionId, { status: DISCONNECTED, disconnectedAt: now })`.
2. `store.startGraceTimerForSession(sessionId, () => abandonActivity(userId, sessionId).catch(...))`.
"Live" = state present in the store (root + `listChildren`). Grace timer is per-session so each expires independently.

### Change — reconnect fan-out (F-02)
`handleReconnect(userId, clientSessionId?)` must iterate **all** of the user's sessions currently in `DISCONNECTED` (root + children that are still in the store) and for EACH:
1. `store.cancelGraceTimerForSession(sessionId)`.
2. `await resumeActivity(userId, sessionId)` → set `ACTIVE`, clear `disconnectedAt`.
Preserve the existing `clientSessionId` ABANDONED-confirmation branch (current lines 439-449) for the case where nothing is in the store. Return shape stays `Promise<ModuleSession | { abandoned: true } | null>`; for the multi-session resume, returning the resumed sole-child (or root) preserves the controller's existing `setup()` handling (controller lines 116-137).

### Behavior preservation (this task only)
The proto does not yet carry `session_id` (added in [[05-proto-session-id-idempotency]]). So `module-state.grpc.controller.ts` resolves the target child as the single active one via `getSoleChild(userId)` (assert exactly one; if zero → existing no-session handling — handlers return early on null/undefined; if >1 cannot happen yet because root creation is [[04-lazy-root-creation]] and concurrent children are [[06-state-controller-concurrent-idempotency]]). Controller call sites to update to pass the resolved `sessionId`:
- `handleActivityEnd` line 327: `endActivity(userId, sessionId, clientTimestampMs)` where `sessionId = getActiveSession(userId)?.sessionId`.
- `handleActivityStop` line 345: `stopActivity(userId, sessionId)`.
- `handleActivityPause` line 363: `pauseActivity(userId, sessionId)`.
- `handleActivityResume` line 388: `unpauseActivity(userId, sessionId)`.
- `handleActivityStart` line 281/306: `getActiveSession(userId)` guard unchanged (returns sole child); `startActivity` unchanged signature.
`getActiveSession(userId)` kept as a convenience that returns the sole child (`= getSoleChild(userId)`). Net external behavior unchanged.

### Guards / gotchas
- `handleSessionRevoked` (controller lines 198-214, F-07): today it reads `getActiveSession(payload.userId)?.sessionId` (201) then `stopActivity(payload.userId)` (203). With multi-session it must stop **every** live child + the root in a loop (`for each sessionId in [root, ...children] → stopActivity(userId, sessionId)`), then `activeStreamRegistry.closeAll(payload.userId)` (213). The `SessionEvents.REVOKED` emit on error (210) stays per-sessionId. **Blocking decision below** governs whether the root is also stopped on revoke.
- Watchdog `abandonStale(userId, sessionId)` (called at `session-watchdog.service.ts:82`) already sessionId-scoped — change its internal store cleanup from `store.get(userId)`/`store.delete(userId)` (engine lines 232-234, 245-247, 265-267) to `store.getChild(userId, sessionId)` / `store.removeChild(userId, sessionId)` (and root equivalent if the stale row is a root). The watchdog `sweep` query (lines 56-63) returns root rows too once they exist — abandonStale must handle a stale root by removing it via the root slot, not `removeChild`.
- Do not introduce root creation here — that is [[04-lazy-root-creation]]. `UserSessions.rootSessionId` exists but stays `null` in this task; `getRoot` returns undefined until then.
- Grace-timer leak: teardown of the engine/store must `clearTimeout` all pending per-session timers; the test ([[16-test-session-lifecycle-state-machine]] Gotchas) asserts no leak with fake timers.

### Verify
- `npm test` + existing realtime e2e (single-session flows) stay green.
- Build clean; no `store.get(userId)` singletons remain in the engine.

## Test reconciliation (committed tests)

Target file: `src/realtime/services/multi-session-lifecycle.spec.ts`.

**GREEN list — cases this note flips RED→GREEN:**

Store (`target — multi-session store [RED until Phase 55]`):
- `should store and retrieve multiple children under one userId (addChild/getChild/listChildren)` (164-183) — casts `addChild` / `getChild` / `listChildren`. ✔ all named in §store-shape.
- `should key grace timers by sessionId, not userId: two children expire independently` (185-213) — casts `startGraceTimerForSession` / `hasPendingGraceTimerForSession`; `graceMs=1000` still from `WS_RECONNECT_GRACE_MS`. ✔
- `sole-child resolution accessor returns the single child …` (215-227) — casts `getSoleChild`. ✔

Engine (`target — engine multi-session [RED until Phase 55]`):
- `transport disconnect moves EVERY live session of a user to disconnected — each with its own per-session grace timer` (583-627) — `setRoot`+`addChild`×2, `handleTransportDisconnect`; asserts `repo.update(sessionId,{...})` for root+A+B and `hasPendingGraceTimerForSession` true for each. Satisfied by §disconnect-fan-out (F-01).
- `reconnect in grace resumes EVERY disconnected session of the user …` (629-698) — `handleReconnect`; asserts all 3 timers cancelled + all 3 rows ACTIVE; `repo.findOne({where:{id}})` dispatch. Satisfied by §reconnect-fan-out (F-02) + GAP-03-C pin.

Characterization (`characterization — engine` / `characterization — store`) — must SURVIVE unchanged (Class B regression if RED): `start→end`, `start→stop`, `disconnect→grace→abandon`, `disconnect→reconnect-in-grace→resume`, `pause/resume`, `abandon no-ops when already ACTIVE`, both `coerceClientTs` branches, and store `set/get/has/delete round-trip` (135-144). Preserved by: optional-`sessionId` sole-child fallback (GAP-03-B) so the 1-arg `makeHelpers` wrappers (104-119) + direct calls (492, 836) keep working with no test edits; legacy `set/get/has/delete` sole-child shims (GAP-03-A); positional `repo.update` / `repo.findOne({where:{id}})` shapes (GAP-03-C).

**ANTI-TARGETS:** none. This note deletes/inverts no committed case. Removing the userId-keyed grace trio (`startGraceTimer`/`cancelGraceTimer`/`hasPendingGraceTimer`) is safe — the committed spec never calls them by name (store-char block deliberately omits them, 145-149; engine reaches them only via the re-pointed `handleTransportDisconnect`/`handleReconnect` wrappers).

**Pinned gap-fixes (folded into §Change):** GAP-03-A legacy sole-child shims; GAP-03-B optional `sessionId` + `getSoleChild` (children-only) fallback; GAP-03-C `repo.findOne({where:{id:sessionId}})` and positional `repo.update(sessionId,{...})` preserved. `listLiveSessions` (in the symbol-list superset) is NOT cast by any committed test — not defined here.

## Open Questions
- Revoke scope (root vs children-only) — promoted to **Blocking decisions** above.
