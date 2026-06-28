# Lazy root session creation + child linking

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- The root session ("app is open" container) is created lazily by the server on the first meaningful event of a stream connection, not by a dedicated client command. Every activity child created afterward is linked via `rootSessionId`.
- Root = `ModuleSession` with `activityType = 'root'`, `rootSessionId = null`. It owns the continuous bio timeline (bio binding lands in [[10-bio-ingest-to-root]]); here it is only created and linked.

## Details

### Current state
- `src/realtime/services/activity-engine.service.ts` `startActivity` creates a child directly with no parent. No root concept.
- `src/realtime/module-state.grpc.controller.ts` `trackActivity` → `setup()` calls `handleReconnect` then subscribes to commands.

### Change
- Add `ActivityEngine.ensureRoot(userId, clientTs?): Promise<ModuleSession>` — idempotent: if `store.getRoot(userId)` exists, return it; else create a `ModuleSession` (`activityType = ROOT`, `status = ACTIVE`, `startedAt = clientTs ?? now`, `rootSessionId = null`), persist, set `store.setRoot(userId, root.id)`. Does **not** push a SESSION_EVENT instruction (root has no instruction stream of its own).
- Call `ensureRoot` from the state-stream `setup()` on connect (cheapest single point — one root per app session). Also call defensively at the top of `startActivity` so a child never exists without a root.
- `startActivity` sets the new child's `rootSessionId = root.id` (entity column + `ActivityState`/store metadata as needed).
- Root lifecycle: on transport disconnect the root goes `disconnected` + grace and is abandoned on expiry, exactly like a child (handled generically by the per-session loop from [[03-multi-session-store-engine]]). The root is never ended via `activity:end` (no client command targets it).

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
