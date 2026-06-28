# deleteRun: clean up the root orphaned by deleting a practice

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- Before the refactor, deleting a practice cascade-deleted its bio (`bio_session_samples.moduleSessionId → child ON DELETE CASCADE`). After bio moves to the root ([[10-bio-ingest-to-root]]), `deleteRun` removes only the child — its bio now lives on the root and would linger forever on a childless root.
- Fix: when `deleteRun` removes the last child of a root, delete the root too (cascade removes its bio). If other children remain, keep the root and its shared bio.

## Details

### Current state — `src/sessions/sessions.service.ts` `deleteRun` (`:137-146`)
- `assertSessionOwnership(userId, sessionId)` (`:138`, defined `:121-135`) loads the row and throws `NotFoundException` / `ForbiddenException`.
- Active-guard: `if (session.endedAt == null) throw new ConflictException('Cannot delete a session that is still active')` (`:139-143`).
- Delete: `await this.moduleSessionRepo.delete({ id: sessionId })` (`:144`), then a log line (`:145`). No awareness of roots.
- `rootSessionId` column is added by the schema task ([[02-root-session-schema]], breadcrumb). `ModuleSession` already injected as `moduleSessionRepo` (`sessions.service.ts:50-52`).

### Inlined schema contracts (this note is self-contained — do not open other notes)
- **`rootSessionId` column** on `ModuleSession` (`src/realtime/entities/module-session.entity.ts`) — nullable `uuid`, a self-referencing FK to `module_sessions.id` declared `ON DELETE CASCADE`. A child practice stores its parent root's id here; legacy pre-migration rows and root rows themselves have `rootSessionId = null`.
- **Cascade semantics** — because the self-FK is `ON DELETE CASCADE`, deleting the root row automatically removes the root's `bio_session_samples` / `session_stream_samples` (their `moduleSessionId` points at the root). So `deleteRun` only issues `moduleSessionRepo.delete({ id: rootId })` for the root; it never deletes bio rows directly (the committed test asserts the bio/stream repos are never touched — `sessions.service.spec.ts:66-80`).

### Change
Replace the body of `deleteRun` (`sessions.service.ts:137-146`) — keep ownership + active-guard (`:138-143`) unchanged, then:

```ts
const rootId = session.rootSessionId; // may be null for legacy rows

// 1. Delete the child first, so it is not counted below.
await this.moduleSessionRepo.delete({ id: sessionId });

// 2. Legacy rows (pre-migration) have no root — nothing else to do.
if (rootId == null) return;

// 3. If the root now has zero remaining children, delete it.
//    FK ON DELETE CASCADE removes the root's bio_session_samples.
const remaining = await this.moduleSessionRepo.count({
  where: { rootSessionId: rootId },
});
if (remaining === 0) {
  await this.moduleSessionRepo.delete({ id: rootId });
}
```

- Use the **injected `moduleSessionRepo` directly** — `delete({ id })` and `count({ where: { rootSessionId } })`. Do NOT wrap in `moduleSessionRepo.manager.transaction(...)`: the committed test mock (`sessions.service.spec.ts:146-151`) is a plain repo with `findOne`/`delete`/`count`/`createQueryBuilder` and NO `manager` — a transaction wrapper throws (`manager` undefined) and turns all three orphan-cleanup cases (`:164,:189,:219`) RED-for-wrong-reason.
- Capture `session.rootSessionId` from the already-loaded `session` (returned by `assertSessionOwnership`, `:138`) **before** the delete.
- Order is fixed: delete the child first, then `count({ where: { rootSessionId } })`; if `0`, delete the root → the self-FK cascade ([[02-root-session-schema]]) removes the root's bio. If `> 0`, leave the root untouched (bio is shared with surviving siblings).
- Keep the existing success log (`sessions.service.ts:145`); optionally add a second log when the root is also deleted.

### Guards / gotchas
- Only acts when the root has zero remaining children. Never delete a root that still has siblings of the deleted practice — that would destroy shared bio.
- Old (pre-migration) sessions with `rootSessionId = null` skip the root branch entirely (step 2 early-return) — unchanged behavior vs. today's single `delete`.
- **Deliberate decision: non-atomic, but ORDERED, with a janitor backstop.** The child-delete → count → conditional root-delete runs as discrete calls on the injected repo, NOT inside a transaction. This trades atomicity for conformance to the committed test contract (the mock has no `manager`). The failure window is safe: a partial failure that deletes the child but not the root leaves a *childless* root. A separate Phase-57 TTL janitor (`SessionWatchdogService.sweepEmptyRoots()`, breadcrumb [[08-janitor-empty-roots]]) periodically finds any root that is `activityType = 'root'`, past its idle TTL, and has zero rows referencing it via `rootSessionId`, and deletes it — the `ON DELETE CASCADE` then removes its bio. So a partial-failure childless root is cleaned up on the next janitor pass; there is no permanently orphaned bio. The janitor is the backstop, so the missing transaction here does not leak data.
- A root row never satisfies the active-guard concern here — `deleteRun` is only ever invoked with a child/practice id from the dashboard; roots are not user-deletable.

### Verify
- Delete the only practice of a root → root and its bio gone (cascade).
- Delete one of two practices sharing a root → root and bio retained; the other practice still reads its windowed bio ([[09-analytics-tolerant-bio-read]]).
- Delete an old session (`rootSessionId` null) → behaves as today (single delete, no root branch).

## Test reconciliation (committed tests)

### GREEN list — cases this note flips RED→GREEN
- `sessions.service.spec.ts:164` `orphan root cleanup › should delete the root after its last child is deleted` — depends on two discrete `repo.delete({ id })` calls, child FIRST then root, gated by `repo.count` returning 0. Test asserts `delete` called 2× with `toHaveBeenNthCalledWith(1, { id: child })` and `(2, { id: ROOT_ID })`.
- `sessions.service.spec.ts:189` `should keep the root when a sibling child remains` — depends on `repo.count({ where: { rootSessionId: ROOT_ID } })` returning 1 → only the child delete fires. Test asserts `delete` 1×, NOT called with `{ id: ROOT_ID }`, and `count` called with exactly `{ where: { rootSessionId: ROOT_ID } }`.
- `sessions.service.spec.ts:219` `should count siblings after deleting the child` — depends on invocation ORDER: child `delete` fires before `count` (`delete.mock.invocationCallOrder[0] < count.mock.invocationCallOrder[0]`).

### Invariants that must stay GREEN (this note must NOT perturb)
- `sessions.service.spec.ts:247` `legacy session with rootSessionId null` — `rootId == null` early-return after the single child delete; `count` NEVER called; exactly 1 delete.
- `sessions.service.spec.ts:47-127` existing `deleteRun` cases (owned / foreign / missing / live) — ownership + active-guard unchanged; the foreign/missing/live guards still throw before any delete; the owned case still deletes `{ id: 'session-uuid' }` first.

### Resolved gap-fix
- DROPPED the `moduleSessionRepo.manager.transaction(...)` wrapper and the `mgr.delete`/`mgr.count` receivers. The cleanup now uses the injected `moduleSessionRepo.delete({ id })` / `moduleSessionRepo.count({ where: { rootSessionId } })` directly — the committed mock has no `manager`, so the wrapper would throw and turn all three cases RED-for-wrong-reason. Atomicity is deliberately traded for the committed test contract; the TTL janitor ([[08-janitor-empty-roots]]) is the backstop for any partial-failure childless root (see Guards / gotchas).

## Open Questions
- None.
