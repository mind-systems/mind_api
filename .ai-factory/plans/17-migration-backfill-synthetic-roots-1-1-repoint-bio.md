# Plan: Migration — backfill synthetic roots 1:1 + repoint bio

## Context
Existing `module_sessions` rows are all activities owning their own bio with no root. This one-time, idempotent, transactional migration creates one synthetic `root` per qualifying activity (1:1), links each child via `rootSessionId`, and repoints its `bio_session_samples` to the synthetic root so the tolerant root-or-child bio read (`sessions.service.ts:174-200`, `bioSessionIds = [session.id, session.rootSessionId]` windowed by `startedAt…endedAt`) keeps returning the same series.

## Prerequisites verified
- `'root'` enum value committed in `1782658908789-AddRootActivityType` (separate, earlier migration). This migration must **not** re-add it.
- `rootSessionId uuid` column + self-referential FK `FK_module_sessions_rootSessionId` `ON DELETE CASCADE` from `1782658936664-AddRootSessionLink`.
- Bio FK `FK_bio_session_samples_moduleSessionId` `ON DELETE CASCADE` from `1779990145496-AddBioSessionSamplesTable`.
- `ModuleSession.metadata` is a nullable `jsonb` column — used here to tag synthetic roots.
- **`migrationsTransactionMode` is NOT set** in either `database.config.ts` (runtime factory) or `src/config/typeorm.config.ts` (CLI DataSource) → it currently defaults to `"all"` (ALL pending migrations share ONE transaction). This is the root cause addressed in Task 1.

## Settings
- Testing: no (verification is manual on a prod snapshot — see Task 5)
- Logging: minimal
- Docs: no

## Project rules to honor
- **Never use the non-null assertion operator `!`** (RULES.md). Read the batch loop's affected count with an explicit destructure/guard, not `result!.affected`.
- CLI-generated migration, never hand-craft the timestamp (`feedback_migrations`, `mind_api/CLAUDE.md`).

## Tasks

### Phase 1: Transaction-mode fix (unblocks the enum usage)

- [x] **Task 1: Set `migrationsTransactionMode: 'each'` in both TypeORM configs** *(addresses Critical C1)*
  Files: `database.config.ts`, `src/config/typeorm.config.ts`
  **Why:** under the current `"all"` default, `AddRootActivityType` (`ADD VALUE 'root'`) and this backfill migration are both pending in the same `migration:run` on any fresh DB (CI, e2e, first prod deploy of `feature/root-session`, and the Task 5 prod-snapshot verification). They execute inside one `BEGIN…COMMIT`, so Postgres rejects every reference to `'root'` with `ERROR: unsafe use of new value "root" of enum type activity_type_enum (SQLSTATE 55P04)` — hitting both the `WHERE "activityType" != 'root'` guard and the `INSERT … 'root'`. Putting `ADD VALUE` in a separate file does NOT help under `"all"`.
  **Change:** add `migrationsTransactionMode: 'each'` to the runtime factory object in `database.config.ts` and to the CLI `DataSource` options in `src/config/typeorm.config.ts`. Under `'each'`, `AddRootActivityType` commits before this migration begins, **and** this migration's `up()`/`down()` body still runs atomically inside its own transaction — satisfying both the enum-safety and the atomic-backfill constraints.
  **Before flipping:** confirm no existing migration relies on cross-migration atomicity (i.e. no migration assumes a prior pending migration in the same run rolls back together). Each current migration under `src/migrations/` is self-contained DDL/data; spot-check the chain to be sure, and note that with `'each'` a failure in migration N leaves migrations `< N` committed.

### Phase 2: Migration

- [x] **Task 2: Scaffold the migration via CLI** (depends on Task 1)
  Files: `src/migrations/<generated>-BackfillRootSessions.ts`
  Generate with `npx typeorm migration:create src/migrations/BackfillRootSessions` — never hand-craft the timestamp. Produces an empty `BackfillRootSessions<timestamp>` class implementing `MigrationInterface`. Do NOT add any `ALTER TYPE … ADD VALUE 'root'` statement (owned by `AddRootActivityType`; now committed in its own transaction thanks to Task 1).

- [x] **Task 3: Implement `up()` — create tagged synthetic roots, link children, repoint bio** (depends on Task 2)
  Files: `src/migrations/<generated>-BackfillRootSessions.ts`
  Set-based, inside the migration's own transaction. Steps in order:
  1. Build a 1:1 child→root id map in a temp table (relies on the `uuid_generate_v4()` extension already used by `bio_session_samples`):
     ```sql
     CREATE TEMP TABLE _root_map (
       "childId" uuid PRIMARY KEY,
       "rootId"  uuid NOT NULL DEFAULT uuid_generate_v4()
     ) ON COMMIT DROP;
     INSERT INTO _root_map ("childId")
       SELECT id FROM module_sessions
       WHERE "activityType" != 'root' AND "rootSessionId" IS NULL;
     ```
     This `WHERE` is the **idempotency guard** — a re-run finds no rows (already-migrated children have a non-null `rootSessionId`), so every step no-ops.
  2. Insert one synthetic root per mapped child, mirroring its timestamps, and **tag it** so `down()` can target exactly these rows (see M1 below). Populate all NOT NULL columns (`userId`, `activityType='root'`, `status`, `startedAt`, `lastActivityAt`); omit `createdAt` (DB `now()` default) and `activityRefId` (root has no ref → NULL); the root's own `rootSessionId` is NULL:
     ```sql
     INSERT INTO module_sessions
       (id, "userId", "activityType", status, "startedAt", "disconnectedAt", "endedAt", "lastActivityAt", metadata, "rootSessionId")
     SELECT
       m."rootId", s."userId", 'root',
       CASE WHEN s."endedAt" IS NOT NULL THEN 'completed' ELSE s.status END,
       s."startedAt", NULL, s."endedAt", s."lastActivityAt",
       '{"backfill":"synthetic-root-v1"}'::jsonb, NULL
     FROM _root_map m JOIN module_sessions s ON s.id = m."childId";
     ```
     `status` is `'completed'` for closed children (`endedAt` not null), mirrors the child's status for in-flight ones (locked spec decision).
  3. Link each child to its root:
     ```sql
     UPDATE module_sessions s SET "rootSessionId" = m."rootId"
     FROM _root_map m WHERE s.id = m."childId";
     ```
  4. Repoint bio rows child→root, **batched at 10_000 rows/batch** (rationale corrected in m1 below), using a `ctid`-bounded sub-select so each pass consumes a fresh chunk (updated rows stop matching the `moduleSessionId = childId` join, so the loop converges):
     ```sql
     UPDATE bio_session_samples b
       SET "moduleSessionId" = m."rootId"
     FROM _root_map m
     WHERE b.ctid IN (
       SELECT b2.ctid FROM bio_session_samples b2
       JOIN _root_map m2 ON b2."moduleSessionId" = m2."childId"
       LIMIT 10000
     ) AND b."moduleSessionId" = m."childId";
     ```
     **Loop termination (M2 — critical):** a non-`RETURNING` `UPDATE` via `queryRunner.query(sql)` returns the rows array (empty `[]`), NOT an affected count — looping on `result.length` would stop after the first batch and silently under-migrate. Read the structured result instead:
     ```ts
     // pseudocode — no non-null assertion (RULES.md)
     let affected = 0;
     do {
       const res = await queryRunner.query(sql, undefined, true); // useStructuredResult → { records, affected, raw }
       affected = typeof res?.affected === 'number' ? res.affected : 0;
     } while (affected > 0);
     ```
  5. **Post-`up()` invariant assertion (m2)** — cheap insurance for a one-shot prod migration with no automated test. **Skip entirely on a no-op re-run** (when `_root_map` has 0 rows) so it does not break the advertised idempotency (I2): capture `const mapped = <count of _root_map rows>` and only run the checks `if (mapped > 0)`. When `mapped > 0`, raise (rolling back the whole transaction) if either holds:
     - any child mapped in this run still has `rootSessionId IS NULL` (join `module_sessions` to `_root_map`), or
     - the number of tagged roots created **in this run** ≠ `mapped`. Compare against rows joined through `_root_map` (e.g. `count(*) FROM module_sessions r JOIN _root_map m ON r.id = m."rootId" WHERE r."activityType"='root'`), **not** the absolute tagged-root count — the absolute count would include roots from a prior run and false-fire on re-run.

     `session_stream_samples` (instructions) is intentionally **not** touched — instructions stay per-child.

- [x] **Task 4: Implement `down()` — cascade-aware, scoped to tagged synthetic roots only** (depends on Task 3) *(addresses Major M1)*
  Files: `src/migrations/<generated>-BackfillRootSessions.ts`
  **Why scoping matters:** once the service is live, the app creates legitimate lazy roots (`activityType='root'`) at runtime, and those can have **multiple children** (the whole point of the feature). A `down()` that targets all roots would (a) delete real app-created roots — data loss, and (b) for multi-child roots, repoint bio to a non-deterministic single child. So every statement filters on the `metadata->>'backfill' = 'synthetic-root-v1'` tag, restricting the rollback to exactly the rows this migration created (all strictly 1:1).
  Ordering is load-bearing because `FK_module_sessions_rootSessionId` is self-referential `ON DELETE CASCADE` — deleting a root before breaking the child's reference would cascade-delete the child. Run in this order:
  1. Repoint bio back to the child (batched the same way as `up()` step 4 — `ctid`-bounded `LIMIT 10000` sub-select, driven by the structured-result `affected` loop):
     ```sql
     UPDATE bio_session_samples b SET "moduleSessionId" = s.id
     FROM module_sessions s
     WHERE b.ctid IN (
       SELECT b2.ctid FROM bio_session_samples b2
       JOIN module_sessions r ON b2."moduleSessionId" = r.id
       WHERE r."activityType" = 'root' AND r.metadata->>'backfill' = 'synthetic-root-v1'
       LIMIT 10000
     )
     AND s."rootSessionId" = b."moduleSessionId"
     AND s."rootSessionId" IS NOT NULL;
     ```
     (Each pass repoints a chunk; updated rows no longer point at a synthetic root, so the join shrinks and the `affected`-driven loop converges.)
  2. Null the children's `rootSessionId` to break the FK reference before deletion:
     ```sql
     UPDATE module_sessions SET "rootSessionId" = NULL
     WHERE "rootSessionId" IN (
       SELECT id FROM module_sessions
       WHERE "activityType" = 'root' AND metadata->>'backfill' = 'synthetic-root-v1'
     );
     ```
  3. Delete only the tagged synthetic roots:
     ```sql
     DELETE FROM module_sessions
     WHERE "activityType" = 'root' AND metadata->>'backfill' = 'synthetic-root-v1';
     ```
  `down()` does NOT remove the `'root'` enum value (Postgres has no `DROP VALUE`; owned by `AddRootActivityType`, which rejects revert).

### Phase 3: Verify

- [x] **Task 5: Build check + manual verification on a prod snapshot** (depends on Task 4)
  Files: _(no source changes — verification only)_
  Run `npm run build` to confirm compilation. Verification is **manual** (no automated DB/integration test). Restore a prod snapshot onto dev, then run `npm run migration:run` (now succeeds end-to-end because Task 1's `'each'` mode commits `AddRootActivityType` before this migration) followed by `npm run migration:revert`. Confirm:
  - Fresh full run applies all three migrations without `55P04`.
  - After `up()`: every pre-existing activity row has a non-null `rootSessionId`; `SELECT count(*)` on `bio_session_samples` is unchanged; all previously child-pointed rows now reference root ids; the post-`up()` invariant assertion (Task 3 step 5) did not fire.
  - Spot-check: dashboard bio for a migrated session returns the same series as before (now via the root branch + window).
  - After `down()`: no tagged synthetic roots remain (`metadata->>'backfill'='synthetic-root-v1'`); bio rows point back at their original child; children's `rootSessionId` is NULL; any app-created roots (if present in the snapshot) are untouched.

## Review items addressed
- **C1** (enum used in same transaction → `55P04`): Task 1 sets `migrationsTransactionMode: 'each'` in both configs; spec note's false "default `\"all\"` = per-migration transaction" claim corrected in `notes/11-migration-backfill-roots.md`.
- **M1** (`down()` deletes/mis-repoints app-created roots): synthetic roots tagged `metadata.backfill = 'synthetic-root-v1'` in `up()`; every `down()` statement scoped to that tag.
- **M2** (batch loop never sees affected count): use `queryRunner.query(sql, undefined, true)` structured result, loop on `affected`, no `!`.
- **m1** (batching rationale): chunking under one transaction does NOT bound lock/WAL (held until COMMIT); it bounds planner/executor + snapshot memory and smooths dead-tuple/bloat — keep batching, corrected the stated reason here.
- **m2** (1:1 invariant guard): added post-`up()` assertion (Task 3 step 5).
- **RULES.md** (no `!`): explicit guard in the batch-loop pseudocode.
- **I1** (review-2: `down()` step 1 "batched" but SQL wasn't): `down()` step 1 SQL now carries the same `ctid`-bounded `LIMIT 10000` sub-select as `up()` step 4, so the structured-result loop has chunks to iterate.
- **I2** (review-2: step-5 assertion breaks idempotency on re-run): the post-`up()` assertion is skipped when `_root_map` is empty, and the root-count check compares roots created **in this run** (joined through `_root_map`), not the absolute tagged-root count.
