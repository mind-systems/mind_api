# Plan: deleteRun — clean up the root orphaned by a deleted practice

## Context
After bio moved from the child practice to the shared root session, `SessionsService.deleteRun` deleting the last child leaves the root (and its bio) stranded. This makes `deleteRun` delete a root once its last child is removed, while keeping roots that still have surviving siblings.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Orphan-root cleanup in deleteRun

- [x] **Task 1: Delete the orphaned root after removing its last child**
  Files: `src/sessions/sessions.service.ts`
  Replace the body of `deleteRun` (`:137-147`). Keep the ownership check (`assertSessionOwnership`, `:139`) and the active-guard `ConflictException` (`:140-144`) exactly as-is. Capture `const rootId = session.rootSessionId;` from the already-loaded `session` **before** any delete. Then, in this fixed order:
  1. `await this.moduleSessionRepo.delete({ id: sessionId });` — delete the child first so it is not counted as a remaining sibling. Keep the existing success log (`:146`).
  2. If `rootId == null` (legacy pre-migration row or a root itself), `return` — no further work. This preserves today's single-delete behavior unchanged.
  3. `const remaining = await this.moduleSessionRepo.count({ where: { rootSessionId: rootId } });` — count remaining children pointing at the same root.
  4. If `remaining === 0`, `await this.moduleSessionRepo.delete({ id: rootId });` — the self-referencing FK `ON DELETE CASCADE` removes the root's `bio_session_samples` automatically. Optionally add a second log line for the root deletion.

  **Hard constraints (from spec):**
  - Use the injected `moduleSessionRepo` directly. Do **NOT** wrap in `moduleSessionRepo.manager.transaction(...)` — the committed test mock (`sessions.service.spec.ts`) is a plain repo with `findOne`/`delete`/`count`/`createQueryBuilder` and no `manager`; a transaction wrapper throws and turns all orphan-cleanup cases RED. Non-atomicity is a deliberate trade-off; a partial failure leaves only a childless root, which the Phase-57 TTL janitor (`SessionWatchdog.sweepEmptyRoots`) sweeps as a backstop.
  - Both deletes must be discrete `moduleSessionRepo.delete({ id })` calls (not a bulk delete) so order — child then root — stays observable.
  - Never delete a root that still has siblings: that would destroy shared bio.

## Verification (manual / against committed tests)
- `npx jest src/sessions/sessions.service.spec.ts` — these committed target cases flip RED→GREEN:
  - `orphan root cleanup › should delete the root after its last child is deleted` — 2 deletes, `delete` called with `{ id: child }` then `{ id: ROOT_ID }`.
  - `should keep the root when a sibling child remains` — `count` returns 1 → only the child delete fires, never `{ id: ROOT_ID }`.
  - `should count siblings after deleting the child` — child `delete` fires before `count` (invocation order).
- These committed invariants must stay GREEN:
  - `legacy session with rootSessionId null` — `rootId == null` early-return; `count` never called; exactly 1 delete.
  - Existing owned/foreign/missing/live `deleteRun` cases — ownership + active-guard unchanged.
