# Lazy root session creation + child linking

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- The root session ("app is open" container) is created lazily by the server on the first meaningful event of a stream connection, not by a dedicated client command. Every activity child created afterward is linked via `rootSessionId`.
- Root = `ModuleSession` with `activityType = 'root'`, `rootSessionId = null`. It owns the continuous bio timeline (bio binding lands in [[10-bio-ingest-to-root]]); here it is only created and linked.

## Details

### Current state (exact)
- `src/realtime/services/activity-engine.service.ts` `startActivity(userId, dto)` (lines 57-96) creates a child via `repo.create({ userId, activityType: dto.activityType, activityRefId: dto.activityRefId, status: SessionStatus.ACTIVE, startedAt, lastActivityAt: now })` (63-70), `repo.save` (71), builds `ActivityState` (73-80), `store.set(userId, state)` (81), pushes `SESSION_EVENT/STARTED` (83-89). No `rootSessionId`, no root concept.
- `endActivity(userId, ...)` (98-167) resolves `store.get(userId)` (102) — would resolve the root once root becomes the userId slot. Must skip root (F-09).
- `src/realtime/module-state.grpc.controller.ts` `trackActivity` → `setup()` (lines 109-162) calls `handleReconnect(userId, clientSessionId)` (110-113), checks `subscriber.closed` (114), handles resume/abandoned (116-137), then `request.subscribe(...)` to route commands (141-159).
- `ActivityState` interface (`src/realtime/interfaces/activity-state.interface.ts`) gains `rootSessionId?: string | null` in [[02-root-session-schema]]; `ActivityType.ROOT = 'root'` and the entity column also land there.

### Upstream contracts (inlined — this note is self-contained)
By the time this task runs, the following already exist as real code from earlier tasks. Inlined here so this note is implementable without opening any other note; the `[[NN]]` links are breadcrumbs only.

**Schema/types (from [[02-root-session-schema]]):**
- `ActivityType.ROOT = 'root'` — member on `src/realtime/enums/activity-type.enum.ts` (alongside `BREATH = 'breath'`, `MEDITATION = 'meditation'`).
- `ModuleSession.rootSessionId: string | null` — nullable uuid column on `src/realtime/entities/module-session.entity.ts`. Root rows: `rootSessionId = null`; child rows point at their root's id.
- `ActivityState` shape (`src/realtime/interfaces/activity-state.interface.ts`): `{ sessionId: string; activityType: ActivityType; activityRefId?: string; startedAt: Date; lastActivityAt: Date; isPaused: boolean; rootSessionId?: string | null }`.

**Store (from [[03-multi-session-store-engine]] — `ActivitySessionStore`, internal `Map<userId, { rootSessionId: string|null; children: Map<sessionId, ActivityState> }>`; root is NOT in the children map):**
- `setRoot(userId: string, sessionId: string, state?: ActivityState): void` — records the user's root id + optional `ActivityState` in the root slot.
- `getRoot(userId: string): ActivityState | undefined` — root state if tracked, else `undefined`.
- `addChild(userId: string, sessionId: string, state: ActivityState): void` — adds a child keyed by `sessionId`.
- `getChild(userId: string, sessionId: string): ActivityState | undefined` — a specific child; children map only (excludes root).
- `getSoleChild(userId: string): ActivityState | undefined` — the single live child; **children map ONLY, excludes the root**. Used as the no-`sessionId` resolution fallback.
- `get(userId: string): ActivityState | undefined` — legacy shim = `getSoleChild(userId)`; children-only, excludes root.
- `removeChild(userId: string, sessionId: string): boolean` — terminal-state cleanup.

**Engine (from [[03-multi-session-store-engine]] — `sessionId` is an OPTIONAL 2nd positional, resolved as `sessionId ?? store.getSoleChild(userId)?.sessionId`):**
- `endActivity(userId: string, sessionId?: string, clientTimestampMs?: number): Promise<ModuleSession | null>`.
- `getActiveSession(userId: string): ActivityState | undefined` = `getSoleChild(userId)`.
- `coerceClientTs(clientTimestampMs?): Date | null` — existing private helper (engine lines 39-55): number/Long/string → `Date`, or `null` when absent/zero/NaN/non-finite.

### Change
- Add `ActivityEngine.ensureRoot(userId: string, clientTimestampMs?: number): Promise<ModuleSession>` — idempotent. Use the existing `coerceClientTs` (engine lines 39-55) to derive the timestamp:
  - If `store.getRoot(userId)` returns a state → re-fetch/return that root (idempotent; no new row, no duplicate). **The idempotent branch issues ZERO `repo.create` and ZERO `repo.save`** (GAP-04 pin) — the committed test asserts the second `ensureRoot` call adds no `repo.save` (`multi-session-lifecycle.spec.ts:757`) and returns the same `id` (758). For reconnect-in-grace this is the same root resumed by `handleReconnect` per [[03-multi-session-store-engine]].
  - Else create and persist:
    ```ts
    const now = new Date();
    const root = this.repo.create({
      userId,
      activityType: ActivityType.ROOT,        // 'root' from [[02-root-session-schema]]
      activityRefId: undefined,               // root has no refId
      status: SessionStatus.ACTIVE,
      startedAt: this.coerceClientTs(clientTimestampMs) ?? now,
      lastActivityAt: now,
      rootSessionId: null,                     // root points at nothing
    });
    const saved = await this.repo.save(root);
    this.activitySessionStore.setRoot(userId, saved.id, { /* ActivityState w/ rootSessionId: null, isPaused: false */ });
    ```
  - Does **NOT** call `streamEngine.push(...)` — root has no instruction/SESSION_EVENT stream of its own (contrast `startActivity` lines 83-89). Does **NOT** emit `SessionEvents.COMPLETED/ABANDONED`-style start events.
- Call site (exact): in `module-state.grpc.controller.ts` `setup()`, AFTER the `handleReconnect` block resolves and BEFORE `request.subscribe(...)` (i.e. between current lines 137 and 141), guarded by `if (subscriber.closed) return;`. One root per app/state-stream connection. Also call `ensureRoot(userId)` defensively at the top of `startActivity` (before `repo.create`, current line 63) so a child never exists without a root — `await` it first to get `root.id`.
- `startActivity` child-linking: set `rootSessionId: root.id` in BOTH the `repo.create({...})` object (add to lines 63-70) and the in-memory `ActivityState` (add to lines 73-80, `rootSessionId: root.id`). Store via `addChild(userId, saved.id, state)` ([[03-multi-session-store-engine]]) rather than `set`.
- Root lifecycle: on transport disconnect the root goes `disconnected` + grace and is abandoned on expiry, exactly like a child (handled generically by the per-session loop in `handleTransportDisconnect`, [[03-multi-session-store-engine]] F-01). The root is never ended via `activity:end`.
- `endActivity` root-skip (F-09): `endActivity(userId, sessionId?, ...)` must resolve the addressed **child**, never the root. `sessionId` is the OPTIONAL 2nd positional from [[03-multi-session-store-engine]] (GAP-03-B). Resolution: `const sid = sessionId ?? store.getSoleChild(userId)?.sessionId`, then `store.getChild(userId, sid)`. **Both paths exclude the root** — `getSoleChild` and `getChild` read the children map only; the root lives in the root slot. This is what keeps the committed `endActivity('user-1')` root-skip test GREEN (`multi-session-lifecycle.spec.ts:797-853`): the call passes NO sessionId, so it falls back to the sole child (`child-session-1`, seeded via `addChild` at 818) and never touches the root (seeded via `setRoot`). If resolution yields nothing or a `activityType === ActivityType.ROOT` state, no-op and `return null` (matches existing null-return contract at engine lines 102-108). Same guard applies to `stopActivity`/`pauseActivity`/`unpauseActivity` — none may target the root.
- `getSoleChild` / `get` resolve over the **children map ONLY** (GAP-04-B): the child-linking test reads the stored state via `store.get('user-1') ?? store.getSoleChild('user-1')` (`multi-session-lifecycle.spec.ts:792-793`) and asserts `rootSessionId === 'root-session-1'`. After `startActivity` stores the child via `addChild`, `get`/`getSoleChild` must return that child (whose `rootSessionId` is the root id), NOT the root state (whose `rootSessionId` is `null`) — otherwise the assertion sees `null` and goes RED.

### Lazy semantics
"Lazy" = no separate `root:start` RPC. Root is materialized on stream connect. Empty roots (connect, then disconnect with no child and no bio) are reaped by the janitor in [[08-janitor-empty-roots]] — cheaper than guessing intent at connect time.

### Guards / gotchas
- `ensureRoot` must be concurrency-safe within a single connect (await before first `startActivity`).
- On reconnect within grace, resume the **existing** root, do not mint a new one (`handleReconnect` already resumes disconnected sessions per [[03-multi-session-store-engine]]; ensure the root is among them).
- Root excluded from stats — see [[07-exclude-root-from-stats]] (its ABANDONED event must not finalise stats).

### Verify
- Open a state stream → exactly one `module_sessions` row with `activityType='root'`, `rootSessionId IS NULL`.
- `activity:start` → child row with `rootSessionId` = that root's id.
- Reconnect in grace → same root id, no duplicate root.

## Test reconciliation (committed tests)

Target file: `src/realtime/services/multi-session-lifecycle.spec.ts`, block `target — ensureRoot / linking [RED until Phase 55 — lazy-root-creation / spec 04]` (701-854).

**GREEN list — cases this note flips RED→GREEN:**
- `should create exactly one root per connection (activityType root, rootSessionId null, status active) and reuse it on repeat calls` (726-759) — `(engine as any).ensureRoot('user-1')` ×2; asserts `activityType==='root'`, `rootSessionId` is `null` (via `toBeNull`, so **null not undefined** — the create object sets `rootSessionId: null`), `status===ACTIVE`, and **no second `repo.save`** on reuse (757) + same `id` (758). Satisfied by `ensureRoot` idempotent zero-write branch.
- `should set a newly started child rootSessionId to the active root id` (761-795) — seeds `setRoot`, calls `startActivity`; asserts saved child `repo.save.mock.calls[0][0].rootSessionId === 'root-session-1'` (789) and stored state `rootSessionId === 'root-session-1'` (794). Satisfied by §startActivity child-linking (set `rootSessionId: root.id` in `repo.create` + `ActivityState`, store via `addChild`) — and the seeded root makes the defensive `ensureRoot` hit its zero-write branch, so the first `repo.save` is the child (788).
- `should never end the root via activity:end — only the addressed child ends, root stays active` (797-853) — `engine.endActivity('user-1')` with NO sessionId; asserts child→COMPLETED, root stays ACTIVE/`endedAt` undefined, exactly one COMPLETED emit with `sessionId:'child-session-1'`. Satisfied by §endActivity root-skip (F-09) + sole-child fallback (GAP-03-B/04): no-sessionId resolves the sole child via `getSoleChild` (children-only), never the root.

**Symbols provided / consumed:** `ensureRoot(userId)` defined here (1-arg call compatible, 2nd arg optional). `setRoot`/`getRoot`/`getSoleChild`/`addChild` consumed from [[03-multi-session-store-engine]]. `ActivityType.ROOT` + `ModuleSession.rootSessionId` + `ActivityState.rootSessionId` consumed from [[02-root-session-schema]]; the spec uses the literal `'root' as any`, so the enum member is needed for this note's production code, not by the test assertions.

**ANTI-TARGETS:** none. This note deletes/inverts no committed case.

**Pinned gap-fixes (folded into §Change):** `ensureRoot` idempotent branch = ZERO `repo.create`/`repo.save`; `endActivity` with no `sessionId` resolves sole child via `getSoleChild` (excludes root) so root-skip holds; `getSoleChild`/`get` resolve over children only.

## Open Questions
- Should a bio-only connection (bio stream opens before the state stream) also trigger `ensureRoot`? Deferred to [[10-bio-ingest-to-root]], which can call `ensureRoot` on first bio batch if no root exists.
