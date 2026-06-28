# Test plan — migration backfill 1:1 + bio repoint (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[11-migration-backfill-roots]].

## Why this area (silent-failure filter)
A data migration is the purest silent-failure surface: a missed row, a wrong repoint, or a non-idempotent re-run corrupts production data with no runtime error. Worse, a bad `down()` can cascade-delete real practices (FK `ON DELETE CASCADE`). Must be tested against a real seeded Postgres, not mocks.

## Behavior under change — think hard before writing
Before writing, enumerate the pre-states the migration must handle: practice with bio, practice without bio, already-migrated rows (`rootSessionId` set), a root-typed row that somehow already exists. Reason about transaction boundaries and batching on a large `bio_session_samples` table. Reason hardest about `down()`: it must repoint bio back to the child and null `rootSessionId` **before** deleting the synthetic root, or the cascade deletes the child. Any unhandled pre-state → **Findings**.

## Red/Green contract
- **Target (RED until [[11-migration-backfill-roots]]):** all cases below — they assert the migration's effect on a seeded DB.
- This is an integration/migration test (run up, assert, run down, assert). No characterization — the migration is net-new.

## Instantiation
Integration test with a disposable Postgres (the project's e2e/migration harness). Seed `module_sessions` (breath + meditation, mixed bio) + `bio_session_samples`, run the migration programmatically (DataSource), assert, then run `down()` and assert reversal.

## Test cases
### up()
- should create exactly one synthetic root per pre-existing non-root session (1:1) — target→11
- should set each child's `rootSessionId` to its synthetic root — target→11
- should repoint every bio row from child to its synthetic root (total bio count unchanged) — target→11
- should leave `session_stream_samples` (instructions) on the child — target→11
- should mirror the child's timestamps onto the synthetic root — target→11
- should be idempotent: a second run touches no already-migrated row — target→11
### down()
- should repoint bio back to the child and null `rootSessionId` before deleting roots — target→11
- should not cascade-delete any original practice or its instructions — target→11 (data-loss guard)
### post-migration read
- should make the migrated session's dashboard bio identical to pre-migration (via [[20-test-windowed-bio-read]] path) — target→11

## Gotchas
- `ALTER TYPE ... ADD VALUE 'root'` (from [[02-root-session-schema]]) may not run in a transaction on older Postgres — confirm the enum value exists before this migration inserts root rows.
- Batch the bio `UPDATE` if seeding a large table to mirror production behavior.
- Assert counts (`SELECT count(*)`), not just spot rows — a missed-row bug hides in aggregates.

## Findings
_(fill during test-writing; escalate to [[11-migration-backfill-roots]] before implementing it)_
