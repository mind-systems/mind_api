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

### Change
- Add `ActivityEngine.ensureRoot(userId: string, clientTimestampMs?: number): Promise<ModuleSession>` — idempotent. Use the existing `coerceClientTs` (engine lines 39-55) to derive the timestamp:
  - If `store.getRoot(userId)` returns a state → re-fetch/return that root (idempotent; no new row, no duplicate). For reconnect-in-grace this is the same root resumed by `handleReconnect` per [[03-multi-session-store-engine]].
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
- `endActivity` root-skip (F-09): `endActivity(userId, sessionId, ...)` must resolve the addressed **child**, never the root. With the explicit `sessionId` threaded by [[03-multi-session-store-engine]], resolve via `store.getChild(userId, sessionId)` (which excludes the root, since root lives in the root slot not the children map). If resolution yields nothing or a `activityType === ActivityType.ROOT` state, no-op and `return null` (matches existing null-return contract at engine lines 102-108). Same guard applies to `stopActivity`/`pauseActivity`/`unpauseActivity` — none may target the root.

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

## Open Questions
- Should a bio-only connection (bio stream opens before the state stream) also trigger `ensureRoot`? Deferred to [[10-bio-ingest-to-root]], which can call `ensureRoot` on first bio batch if no root exists.
