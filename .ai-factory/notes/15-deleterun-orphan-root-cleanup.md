# deleteRun: clean up the root orphaned by deleting a practice

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- Before the refactor, deleting a practice cascade-deleted its bio (`bio_session_samples.moduleSessionId → child ON DELETE CASCADE`). After bio moves to the root ([[10-bio-ingest-to-root]]), `deleteRun` removes only the child — its bio now lives on the root and would linger forever on a childless root.
- Fix: when `deleteRun` removes the last child of a root, delete the root too (cascade removes its bio). If other children remain, keep the root and its shared bio.

## Details

### Current state — `src/sessions/sessions.service.ts` `deleteRun`
- Asserts ownership, refuses if the session is still active (`endedAt == null`), then `moduleSessionRepo.delete({ id: sessionId })`. No awareness of roots.

### Change
- After deleting the child, read its `rootSessionId`. If non-null, count remaining children: `SELECT count(*) FROM module_sessions WHERE "rootSessionId" = :root`. If `0`, delete the root (`moduleSessionRepo.delete({ id: root })`) — the FK cascade removes the root's bio. If `> 0`, leave the root untouched (bio is shared with surviving siblings).
- Order: delete the child first, then evaluate the root, so the just-deleted child is not counted.

### Guards / gotchas
- Only acts when the root has zero remaining children. Never delete a root that still has siblings of the deleted practice — that would destroy shared bio.
- Old (pre-migration) sessions with `rootSessionId = null` skip this path entirely — unchanged behavior.
- Wrap child-delete + root-delete in a transaction so a crash cannot leave a childless root with no bio-owner inconsistency.
- This is the *immediate* cleanup; the TTL janitor ([[08-janitor-empty-roots]]) is the backstop for roots orphaned by disconnect rather than explicit delete.

### Verify
- Delete the only practice of a root → root and its bio gone.
- Delete one of two practices sharing a root → root and bio retained; the other practice still reads its windowed bio.
- Delete an old session (`rootSessionId` null) → behaves as today.

## Open Questions
- None.
