# Plan: Implement `up()` migration

## Context
Fill in the empty `up()` method of the existing `RenameToModuleSessions1774779899323` migration with raw SQL that renames the `live_sessions` table, its enum, indices, and primary key constraint to the `module_sessions` naming. Also update the entity decorator to match the new table name.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Important: overlap with prior migration

Migration `1774778297835-RenameSessionStreamSampleLiveSessionId` (runs before this one) already handles:
- Renaming column `"liveSessionId"` → `"moduleSessionId"` in `session_stream_samples`
- Dropping `IDX_session_stream_samples_liveSessionId` and creating `IDX_session_stream_samples_moduleSessionId`

**Do NOT duplicate those operations** in this migration — they would fail at runtime since the prior migration already applied them.

## Important: the actual enum name is `session_status_enum`

The original `AddLiveSession1773469567000` migration creates the enum as `session_status_enum` (line 8: `CREATE TYPE "public"."session_status_enum" AS ENUM(...)`). No subsequent migration renames it. The `AddInterruptedSessionStatus1773652922852` migration references `live_sessions_status_enum`, but since that name doesn't exist, its `pg_type` check returns 0 rows and the `ALTER TYPE` never executes — the `interrupted` value was never added via migration.

**The correct rename statement is:**
```sql
ALTER TYPE "session_status_enum" RENAME TO "module_sessions_status_enum"
```

## Known issue: missing enum values

The `SessionStatus` TypeScript enum includes `interrupted` and `resumed`, but no migration has successfully added these values to the PostgreSQL `session_status_enum` type (only `active`, `disconnected`, `completed`, `abandoned` exist from the original creation). This is a pre-existing gap — this migration will carry it forward. A separate follow-up should add the missing values with `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.

## Tasks

### Phase 1: Implement migration and update entity

- [x] **Task 1: Write `up()` body with raw SQL statements**
  Files: `src/migrations/1774779899323-RenameToModuleSessions.ts`
  Add the following `await queryRunner.query(...)` calls inside `up()`, in this order:

  1. **Rename table:** `ALTER TABLE "live_sessions" RENAME TO "module_sessions"`
  2. **Rename enum:** `ALTER TYPE "session_status_enum" RENAME TO "module_sessions_status_enum"`
  3. **Drop old indices on the renamed table:**
     - `DROP INDEX "IDX_live_sessions_userId"`
     - `DROP INDEX "IDX_live_sessions_status"`
  4. **Recreate indices on the renamed table:**
     - `CREATE INDEX "IDX_module_sessions_userId" ON "module_sessions" ("userId")`
     - `CREATE INDEX "IDX_module_sessions_status" ON "module_sessions" ("status")`
  5. **Rename primary key constraint:** `ALTER TABLE "module_sessions" RENAME CONSTRAINT "PK_live_sessions_id" TO "PK_module_sessions_id"`

  Each statement must be a separate `await queryRunner.query(...)` call, following the same style as `AddLiveSession1773469567000` and `DropActivityRefTypeFromLiveSessions1774552349945`.

- [x] **Task 2: Write `down()` body reversing all operations**
  Files: `src/migrations/1774779899323-RenameToModuleSessions.ts`
  Add the following `await queryRunner.query(...)` calls inside `down()`, reversing Task 1 in opposite order:

  1. **Rename PK back:** `ALTER TABLE "module_sessions" RENAME CONSTRAINT "PK_module_sessions_id" TO "PK_live_sessions_id"`
  2. **Drop new indices:**
     - `DROP INDEX "IDX_module_sessions_status"`
     - `DROP INDEX "IDX_module_sessions_userId"`
  3. **Recreate old indices:**
     - `CREATE INDEX "IDX_live_sessions_status" ON "module_sessions" ("status")`
     - `CREATE INDEX "IDX_live_sessions_userId" ON "module_sessions" ("userId")`
  4. **Rename enum back:** `ALTER TYPE "module_sessions_status_enum" RENAME TO "session_status_enum"`
  5. **Rename table back:** `ALTER TABLE "module_sessions" RENAME TO "live_sessions"`

  Note: in step 3, the indices are created on `"module_sessions"` (current table name before step 5 renames it back). PostgreSQL index references follow the table regardless of table rename, so the indices will point to `"live_sessions"` after step 5.

- [x] **Task 3: Update entity decorator to match new table name**
  Files: `src/realtime/entities/module-session.entity.ts`
  Change `@Entity('live_sessions')` → `@Entity('module_sessions')` on line 11. This is critical — `migrationsRun: true` in `database.config.ts` means the migration runs on startup before TypeORM queries the table. If the entity still points to `live_sessions`, the app will crash with "relation does not exist" after the migration renames it.
