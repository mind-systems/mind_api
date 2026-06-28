# Data migration: backfill synthetic roots 1:1 + repoint bio

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- Existing production data has bio attached to activity sessions and no roots. A one-time migration creates one synthetic root per existing session (1:1 — confirmed decision), links the session via `rootSessionId`, and repoints its bio rows to the synthetic root so the tolerant read ([[09-analytics-tolerant-bio-read]]) returns them via the root branch.
- 1:1 (not time-window grouping) keeps current analytics identical with zero heuristics. Merging multiple activities under shared roots can come later if needed.

## Details

### Current state
- `module_sessions`: all rows are activities (`breath`/`meditation`), `rootSessionId IS NULL`.
- `bio_session_samples.moduleSessionId` → the activity row.

### Change — one CLI-generated migration (raw SQL)
For each existing session `S` where `activityType != 'root' AND rootSessionId IS NULL`:
1. Insert synthetic root `R`: `userId = S.userId`, `activityType = 'root'`, `status = S.status` (or a terminal status), `startedAt = S.startedAt`, `endedAt = S.endedAt`, `lastActivityAt = S.lastActivityAt`, `rootSessionId = NULL`.
2. `UPDATE module_sessions SET rootSessionId = R.id WHERE id = S.id`.
3. `UPDATE bio_session_samples SET moduleSessionId = R.id WHERE moduleSessionId = S.id`.

Instruction samples (`session_stream_samples`) stay on the child — instructions remain per-activity.

### Guards / gotchas
- Generate via CLI: `npx typeorm migration:create src/migrations/BackfillRootSessions` — never hand-craft the timestamp ([[feedback_migrations]]).
- Run **after** [[10-bio-ingest-to-root]] so the target model is final; ordering is enforced by the linear sequence.
- Wrap in a transaction; batch the `bio_session_samples` UPDATE if the table is large (it holds the bulk of all rows).
- `ON DELETE CASCADE` on `rootSessionId` means deleting a synthetic root deletes its child — `down()` must repoint bio back to `S`, null `S.rootSessionId`, **then** delete `R` (order matters to avoid cascade-deleting `S`).
- Idempotent guard: only touch rows with `rootSessionId IS NULL` so a re-run is safe.
- Post-migration consequence: each migrated practice now has a 1:1 synthetic root carrying its bio. Deleting that practice later orphans the root — handled by the childless-root reap rule ([[08-janitor-empty-roots]]) and the immediate `deleteRun` cleanup ([[15-deleterun-orphan-root-cleanup]]). Do not rely on the old "delete practice cascades bio" behavior — bio is on the root now.

### Verify
- Every pre-existing activity row has a non-null `rootSessionId`.
- `SELECT count(*)` on `bio_session_samples` unchanged; all repointed rows now reference root ids.
- Spot-check: dashboard bio for a migrated session returns the same series as before (now via the root branch + window).

## Open Questions
- Whether to also set a distinct terminal status on synthetic roots (e.g. `completed`) vs mirroring the child's status — cosmetic; pick `completed` for closed sessions.
