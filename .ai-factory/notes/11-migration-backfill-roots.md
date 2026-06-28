# Data migration: backfill synthetic roots 1:1 + repoint bio

**Date:** 2026-06-28
**Source:** conversation context

## Decisions (locked)
- Synthetic-root `status`: `'completed'` for closed children (`endedAt` not null), mirror the child's `status` for in-flight children (`endedAt` null).
- Bio UPDATE batch size: **10_000 rows/batch**.
- Verification is **manual** — no automated DB/integration test (the test task was dropped). Validate by restoring a prod snapshot onto the dev environment and running `up()`/`down()` against it (see Verify).

## Key Findings

- Existing production data has bio attached to activity sessions and no roots. A one-time migration creates one synthetic root per existing session (1:1 — confirmed decision), links the session via `rootSessionId`, and repoints its bio rows to the synthetic root so the tolerant read ([[09-analytics-tolerant-bio-read]]) returns them via the root branch.
- 1:1 (not time-window grouping) keeps current analytics identical with zero heuristics. Merging multiple activities under shared roots can come later if needed.

## Details

### Current state
- `module_sessions`: all rows are activities (`breath`/`meditation`), `rootSessionId IS NULL` (column added by [[02-root-session-schema]] — `module-session.entity.ts:26-27` shape, FK `FK_module_sessions_rootSessionId ... ON DELETE CASCADE`).
- `bio_session_samples.moduleSessionId` → the activity row. FK `FK_bio_session_samples_moduleSessionId ... ON DELETE CASCADE` (`1779990145496-AddBioSessionSamplesTable.ts:13`).
- NOT NULL columns on `module_sessions` that the synthetic root INSERT must populate (from `module-session.entity.ts`): `userId` (`:20-21`), `activityType` (`:23-24`), `status` (`:29-30`, has default `'active'`), `startedAt` (`:32-33`), `lastActivityAt` (`:41-42`), `createdAt` (`@CreateDateColumn`, DB default `now()`). Nullable: `activityRefId`, `disconnectedAt`, `endedAt` (`:38-39`), `metadata`, `rootSessionId`.
- Postgres enum type is `"public"."activity_type_enum"`; the `'root'` value is added by [[02-root-session-schema]]'s `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'root'` (mirrors `1780146744056-AddMeditationActivityType.ts:5-7`).

### Inlined contracts (this note is self-contained — do not open other notes)
The schema prerequisites this migration's SQL touches (provided by an earlier schema task; must be committed before this migration runs):
- **`module_sessions."rootSessionId"`** — nullable uuid column with self-referential FK `FK_module_sessions_rootSessionId` `ON DELETE CASCADE`. `up()` writes it (link child→root); `down()` nulls it before deleting roots (cascade ordering — see down()).
- **`"public"."activity_type_enum"` value `'root'`** — added via `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'root'` in a **separate, earlier** migration (Postgres forbids using a newly-added enum value in the same transaction that adds it). This migration only INSERTs `activityType = 'root'` rows; it must NOT contain the `ADD VALUE` statement.
- **`bio_session_samples."moduleSessionId"`** — uuid FK to `module_sessions(id)`, `ON DELETE CASCADE` (`FK_bio_session_samples_moduleSessionId`); `up()` repoints it child→root, `down()` repoints root→child.

### Dependency / ordering (HARD constraint)
Postgres forbids using a newly-added enum value in the **same transaction** that adds it (this is exactly why `AddMeditationActivityType` is a single-statement migration). TypeORM runs each migration in its own transaction (`migrationsTransactionMode` defaults to `"all"`). Therefore:
- The `ALTER TYPE ... ADD VALUE 'root'` migration from [[02-root-session-schema]] **must be committed in an earlier, separate migration** before this backfill migration runs (this migration INSERTs `activityType = 'root'` rows).
- This backfill migration must **not** itself contain the `ADD VALUE` statement. Linear migration sequence enforces the order.

### Change — one CLI-generated migration (raw SQL, single transaction)
Operate set-based, not row-by-row. For all existing sessions `S` where `activityType != 'root' AND rootSessionId IS NULL`:

**up():**
1. Insert one synthetic root `R` per qualifying `S`, capturing the `S.id ↔ R.id` mapping in a temp table (so steps 2–3 can join). 1:1 mapping (one root per child):
   ```sql
   CREATE TEMP TABLE _root_map ("childId" uuid PRIMARY KEY, "rootId" uuid NOT NULL DEFAULT uuid_generate_v4());
   INSERT INTO _root_map ("childId")
     SELECT id FROM module_sessions
     WHERE "activityType" != 'root' AND "rootSessionId" IS NULL;

   INSERT INTO module_sessions
     (id, "userId", "activityType", status, "startedAt", "disconnectedAt", "endedAt", "lastActivityAt", metadata, "rootSessionId")
   SELECT
     m."rootId", s."userId", 'root',
     CASE WHEN s."endedAt" IS NOT NULL THEN 'completed' ELSE s.status END,
     s."startedAt", NULL, s."endedAt", s."lastActivityAt", NULL, NULL
   FROM _root_map m JOIN module_sessions s ON s.id = m."childId";
   ```
   `status` is `'completed'` for closed children (`endedAt` not null) and mirrors the child for in-flight ones (locked decision above). `createdAt` is omitted → DB `now()` default. `activityRefId` omitted → NULL (a root has no activity ref).
2. Link each child to its root:
   ```sql
   UPDATE module_sessions s SET "rootSessionId" = m."rootId"
   FROM _root_map m WHERE s.id = m."childId";
   ```
3. Repoint bio rows from child to root — **batched** (see batch note below):
   ```sql
   UPDATE bio_session_samples b SET "moduleSessionId" = m."rootId"
   FROM _root_map m WHERE b."moduleSessionId" = m."childId";
   ```

Instruction samples (`session_stream_samples`) stay on the child — instructions remain per-activity (confirmed: this migration does not touch `session_stream_samples`).

### down() — exact ordering (avoid self-FK cascade eating the child)
`FK_module_sessions_rootSessionId` is `ON DELETE CASCADE` and self-referential: deleting a synthetic root `R` would cascade-delete its child `S` (which points at `R`). So `down()` MUST run in this order:
1. **Repoint bio back to the child first** — for every synthetic root, move its bio rows back to the child that references it:
   ```sql
   UPDATE bio_session_samples b SET "moduleSessionId" = s.id
   FROM module_sessions s
   WHERE s."rootSessionId" = b."moduleSessionId"
     AND b."moduleSessionId" IN (SELECT id FROM module_sessions WHERE "activityType" = 'root');
   ```
2. **Null the child's `rootSessionId`** (break the FK reference before deleting the root, so the cascade has nothing to follow):
   ```sql
   UPDATE module_sessions SET "rootSessionId" = NULL
   WHERE "rootSessionId" IN (SELECT id FROM module_sessions WHERE "activityType" = 'root');
   ```
3. **THEN delete the synthetic roots:**
   ```sql
   DELETE FROM module_sessions WHERE "activityType" = 'root';
   ```
   (Order 1→2→3 is load-bearing: doing step 3 before step 2 would cascade-delete the children.)
   Note: `down()` cannot remove the `'root'` enum value (Postgres has no `DROP VALUE`); that is owned by [[02-root-session-schema]] and is not reverted here.

### Guards / gotchas
- Generate via CLI: `npx typeorm migration:create src/migrations/BackfillRootSessions` — never hand-craft the timestamp ([[feedback_migrations]]).
- Run **after** [[10-bio-ingest-to-root]] so the target model is final, and **after** [[02-root-session-schema]]'s `ADD VALUE 'root'` is committed (separate prior migration — see Dependency / ordering above). Ordering is enforced by the linear migration sequence.
- Everything in `up()`/`down()` runs in one transaction (TypeORM default `migrationsTransactionMode: "all"`).
- **Batch size for the bio UPDATE: recommend 10 000 rows per batch.** `bio_session_samples` holds the bulk of all rows (one row per flushed batch of samples). A single set-based UPDATE locks/rewrites the whole table; chunking by `ctid` or by a `LIMIT`-driven loop keeps lock duration and WAL bounded. Locked at **10_000 rows/batch**; raise toward 50 000 if prod volume is modest, lower if lock contention shows up.
- `ON DELETE CASCADE` on `rootSessionId` is self-referential — see down() ordering above.
- Idempotent guard: `up()` only selects rows with `"activityType" != 'root' AND "rootSessionId" IS NULL` (the `_root_map` populate query), so a re-run creates no duplicate roots — already-migrated children have a non-null `rootSessionId` and are skipped.
- Post-migration consequence: each migrated practice now has a 1:1 synthetic root carrying its bio. Deleting that practice later orphans the root — handled by the childless-root reap rule ([[08-janitor-empty-roots]]) and the immediate `deleteRun` cleanup ([[15-deleterun-orphan-root-cleanup]]). Do not rely on the old "delete practice cascades bio" behavior — bio is on the root now.

### Verify
- Every pre-existing activity row has a non-null `rootSessionId`.
- `SELECT count(*)` on `bio_session_samples` unchanged; all repointed rows now reference root ids.
- Spot-check: dashboard bio for a migrated session returns the same series as before (now via the root branch + window).

## Open Questions
- Synthetic-root `status` — see Blocking decisions. Cosmetic; default in the SQL above mirrors the child's status. Pick `'completed'` for closed (`endedAt` not null) sessions if the product wants roots to read as terminal.

## Test reconciliation (committed tests)

**NO automated DB/integration test** — verification is manual (§Decisions, §Verify; the test task was dropped). Validate by restoring a prod snapshot onto dev and running `up()`/`down()` (§Verify). No committed case flips RED→GREEN; nothing to invert or delete.

The migration contract is internally complete and self-consistent:
- **1:1 synthetic root per qualifying child**, INSERT populates all NOT NULL columns; idempotent guard skips already-migrated children (`rootSessionId IS NOT NULL`).
- **`down()` ordering** (repoint bio back → null child `rootSessionId` → delete roots) is load-bearing against the self-referential `ON DELETE CASCADE`.
- **Bio repointed to root** so the tolerant read ([[09-analytics-tolerant-bio-read]]) returns it via the root branch — instructions stay on the child.

Depends only on note [[02-root-session-schema]] (the `'root'` enum value committed in a prior migration + the `rootSessionId` column); runs after [[10-bio-ingest-to-root]] so the target model is final. No forward-coupling gap. Confirmed complete.
