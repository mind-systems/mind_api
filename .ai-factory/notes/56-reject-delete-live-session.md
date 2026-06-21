# Reject deleting a non-finalized (live) module-session

**Date:** 2026-06-21
**Source:** conversation context

## Key Findings

- `SessionsService.deleteRun` (Phase 45) hard-deletes any owned `module_sessions` row. It must additionally **reject sessions that are still live** — only finalized runs may be deleted.
- Canonical "finalized" predicate: **`endedAt IS NOT NULL`**. This is exactly the set of terminal statuses `COMPLETED` / `ABANDONED` / `INTERRUPTED` (each sets `endedAt`); the live statuses `ACTIVE` / `DISCONNECTED` / `RESUMED` leave `endedAt` null. Matches the `listRuns` filter (`ms.endedAt IS NOT NULL`).
- Deleting a live session corrupts the realtime state machine: in-memory engines (`StreamEngine`, `BiometricStreamEngine`, `ActivityEngine`/`ActivitySessionStore`) still hold the session; the next periodic flush inserts samples → **FK violation** against the now-deleted parent; `ActiveStreamRegistry` still has subscribers; the idle watchdog / reconnect-grace machinery references a row that no longer exists.
- This is defense-in-depth, **not** UI-redundant: `assertSessionOwnership` intentionally omits the `endedAt` filter (documented at `sessions.service.ts:99-101`) because the dashboard's live-session view reads in-flight data — so a live session id is reachable by a direct API call even though `listRuns` never surfaces one.

## Details

### Scope — separate atomic milestone, depends on Phase 45

Add the finalized-guard to the existing `SessionsService.deleteRun`. No new endpoint, no migration, no proto, no module change. Ships on top of Phase 45.

### Service change — `src/sessions/sessions.service.ts`

`deleteRun` currently does `await this.assertSessionOwnership(userId, sessionId)` then `delete({ id })`. `assertSessionOwnership` (lines ~102-115) already `findOne`s the row but returns `void`. Two clean options:

- (preferred) Change `assertSessionOwnership` to **return the loaded `ModuleSession`** (backward-compatible — `listBiometrics`/`listInstructions` ignore the return), then in `deleteRun`:

```ts
const session = await this.assertSessionOwnership(userId, sessionId);
if (session.endedAt == null) {
  throw new ConflictException('Cannot delete a session that is still active');
}
await this.moduleSessionRepo.delete({ id: sessionId });
```

- or do a dedicated `findOne` in `deleteRun` (one extra query). Prefer reusing the helper's fetch.

`ConflictException` from `@nestjs/common` → HTTP **409**. 409 is the correct status (the resource's current state conflicts with the delete), distinct from 404 (missing) and 403 (foreign owner).

### Guards

- Predicate keys on the **DB** `endedAt` — do NOT reach into realtime in-memory state (`ActivitySessionStore`/`ActiveStreamRegistry`); `SessionsModule` must not depend on `RealtimeModule` internals (modular-monolith boundary). The DB column is the source of truth.
- Order of checks: ownership (404/403) **before** the finalized check (409) — don't leak existence/state of another user's session.
- Everything else from Phase 45 unchanged (cascade, no `breath_sessions`/`user_stats`/`meditation_notes` touch, no sync event).

### Verify

- Live session (owned, `endedAt` null / status `ACTIVE`) → **409**, `moduleSessionRepo.delete` NOT called.
- Finalized session (owned, `endedAt` set) → 204, deletes + cascade.
- Foreign → 403, missing → 404 (unchanged, and checked before the 409).
- Unit-test the new live→409 branch alongside the existing three; if `assertSessionOwnership` now returns the entity, keep its existing callers green.

## Open Questions

None — predicate (`endedAt IS NOT NULL`), status (409), and the no-touch / no-realtime-coupling constraints are settled.
