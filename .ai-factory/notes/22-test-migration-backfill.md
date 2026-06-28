# Test plan — migration backfill 1:1 + bio repoint (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[11-migration-backfill-roots]].

## Blocking decisions
- **No Postgres migration/integration test harness exists.** The only e2e file is `test/app.e2e-spec.ts` (boots `AppModule`, hits `GET /`); `test/jest-e2e.json` has no disposable-DB setup, no Testcontainers, no seed/teardown. This note's "integration test against a seeded Postgres" cannot be written without first building that harness (a disposable Postgres via Testcontainers or a dedicated test DB + `DataSource` that runs migrations programmatically). **Decision needed: build the harness as part of spec 11, or descope these tests to a manual/checklist verification.** Recommendation: add a minimal Testcontainers-backed `*.migration-spec.ts` harness (own jest config) since the migration is the highest silent-failure surface and the windowed-bio SQL path (note 20) needs the same harness.

## Test authoring constraints (the four lessons)
- **L1 — outcomes only:** assert post-migration DB STATE (row COUNTS and the data values), never the migration's intermediate SQL statements or batching internals. `up()` then assert; `down()` then assert reversal.
- **L2 — compile-now:** N/A in the usual sense — this is integration SQL, not mocked TS. But the `'root'` enum value and `rootSessionId` column come from spec 02; the test must run spec 02's migrations before asserting (run the full `DataSource` migration chain, not just spec 11's file).
- **L3 — label by spec name:** all cases `RED until spec 11-migration-backfill-roots` (and gated on spec 02-root-session-schema for the enum/column). Never a phase number.
- **L4 — escalation valve:** net-new migration, no characterization — nothing to mis-classify as a regression here.

## Why this area (silent-failure filter)
A data migration is the purest silent-failure surface: a missed row, a wrong repoint, or a non-idempotent re-run corrupts production data with no runtime error. Worse, a bad `down()` can cascade-delete real practices (FK `ON DELETE CASCADE`). Must be tested against a real seeded Postgres, not mocks.

## Behavior under change — think hard before writing
Before writing, enumerate the pre-states the migration must handle: practice with bio, practice without bio, already-migrated rows (`rootSessionId` set), a root-typed row that somehow already exists. Reason about transaction boundaries and batching on a large `bio_session_samples` table. Reason hardest about `down()`: it must repoint bio back to the child and null `rootSessionId` **before** deleting the synthetic root, or the cascade deletes the child. Any unhandled pre-state → **Findings**.

## Red/Green contract
- **Target (RED until [[11-migration-backfill-roots]]):** all cases below — they assert the migration's effect on a seeded DB.
- This is an integration/migration test (run up, assert, run down, assert). No characterization — the migration is net-new.

## Instantiation
Integration test with a disposable Postgres. **No harness exists yet** (see Blocking decisions) — must be created. Use a `DataSource` built from `src/config/typeorm.config.ts` (the CLI DataSource, per CLAUDE.md) pointed at the disposable DB, run `dataSource.runMigrations()` to apply the full chain (incl. spec 02's enum-add + column migrations), seed `module_sessions` (breath + meditation, mixed bio) + `bio_session_samples`, run spec 11's migration programmatically, assert, then `dataSource.undoLastMigration()` and assert reversal. Migrations run inside a transaction by default (`migrationsTransactionMode` unset → `"all"`, per `02-root-session-schema` gotchas).

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

## Exact pins (read from source)
- **Enum dependency:** the `'root'` value is added by [[02-root-session-schema]] in its OWN migration via `ALTER TYPE "public"."activity_type_enum" ADD VALUE IF NOT EXISTS 'root'` — exact precedent is `AddMeditationActivityType` (`src/migrations/1780146744056-AddMeditationActivityType.ts:5-7`; enum type name `"public"."activity_type_enum"`, lowercase value, `IF NOT EXISTS`). Postgres requires `ADD VALUE` to commit in a separate transaction before that value is USED — so spec 11 (which INSERTs `activityType='root'` rows) must run as a LATER migration than the enum-add. The test runs the whole chain, so this is satisfied automatically; assert that `up()` succeeds (does not throw `unsafe use of new value`).
- **`down()` reject precedent:** the enum-add migration's `down()` rejects loudly (`AddMeditationActivityType.ts:10-22`) — Postgres has no `DROP VALUE`. Spec 11's `down()` must instead repoint bio back to the child and null `rootSessionId` BEFORE deleting synthetic roots (else the `ON DELETE CASCADE` self-FK — `02-root-session-schema`: `FK_module_sessions_rootSessionId … ON DELETE CASCADE` — deletes the child). Assert no original practice/instruction row is lost after `down()`.
- **Bio repoint:** bio is keyed by `bio_session_samples.moduleSessionId` (`biometric-stream-engine.service.ts:165`; entity `BioSessionSample`). `up()` repoints child→root; `down()` repoints root→child. Assert `SELECT count(*) FROM bio_session_samples` is unchanged across up and down.
- **Instructions stay on child:** `session_stream_samples.moduleSessionId` is NOT repointed (instructions remain per-child). Assert their `moduleSessionId` is untouched by both up and down.
- **Idempotency:** a second `up()` (rows already have `rootSessionId` set, root rows already exist) touches nothing new — assert root count and bio distribution identical after the second run.
- **Counts table:** `module_sessions`, `bio_session_samples`, `session_stream_samples` — assert `count(*)` per table before/after each phase, not just spot rows.

## Gotchas
- `ALTER TYPE ... ADD VALUE 'root'` (from [[02-root-session-schema]]) lives in its own migration and commits before spec 11 uses it — running the full migration chain in the test satisfies this ordering.
- Batch the bio `UPDATE` if seeding a large table to mirror production behavior.
- Assert counts (`SELECT count(*)`), not just spot rows — a missed-row bug hides in aggregates.

## Findings
_(fill during test-writing; escalate to [[11-migration-backfill-roots]] before implementing it)_
