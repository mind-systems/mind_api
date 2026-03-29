## Code Review — Plan 38: Implement up() migration

**Files reviewed:** migration `1774779899323-RenameToModuleSessions.ts`, entity `module-session.entity.ts`, plan file
**Context files:** `AddLiveSession1773469567000`, `AddInterruptedSessionStatus1773652922852`, `RenameSessionStreamSampleLiveSessionId1774778297835`, `database.config.ts`, `typeorm.config.ts`, `session-status.enum.ts`, `session-stream-sample.entity.ts`
**Risk level:** 🟢 Low

### Migration `up()` — Correctness

| Step | SQL | Verdict |
|------|-----|---------|
| 1 | `ALTER TABLE "live_sessions" RENAME TO "module_sessions"` | ✅ Correct |
| 2 | `ALTER TYPE "session_status_enum" RENAME TO "module_sessions_status_enum"` | ✅ Correct — matches the name created in `AddLiveSession1773469567000` line 8 |
| 3–4 | Drop old indices, create new ones | ✅ Index names match those created in `AddLiveSession` lines 33–39 |
| 5 | `RENAME CONSTRAINT "PK_live_sessions_id" TO "PK_module_sessions_id"` | ✅ PK name matches `AddLiveSession` line 29 |

**Operation ordering** is correct — table rename first, then DDL on the new table name. Indices are dropped by name (PostgreSQL doesn't auto-rename indices on table rename), then recreated with new names.

**No overlap with prior migration** — `1774778297835` handles `session_stream_samples` column/index renames only. This migration touches `live_sessions` table objects only. ✅

### Migration `down()` — Correctness

Reverse order is correct: PK rename → drop new indices → recreate old indices (on `"module_sessions"` before table rename) → enum rename → table rename. After execution, the DB state returns to pre-migration names. ✅

### Entity Update

`@Entity('live_sessions')` → `@Entity('module_sessions')` — essential change. Since `migrationsRun: true` runs migrations on startup before TypeORM queries, the entity must reference the post-migration table name. ✅

### Migration Registration

Both `database.config.ts` and `typeorm.config.ts` use glob-based migration discovery. TypeORM executes in timestamp order: `1774778297835` (column rename) → `1774779899323` (table rename). Correct. ✅

### No Remaining References

Searched all source files outside `src/migrations/` — no remaining references to `live_sessions`, `IDX_live_sessions_*`, or `PK_live_sessions_*`. All services (`activity-engine`, `stream-engine`, `startup-recovery`) import `ModuleSession` and use `@InjectRepository(ModuleSession)`. ✅

### Pre-existing Issue (not introduced by this change)

The `SessionStatus` TypeScript enum includes `interrupted` and `resumed`, but these values were never successfully added to the PostgreSQL `session_status_enum` (the `AddInterruptedSessionStatus` migration targets the wrong enum name `live_sessions_status_enum`). This migration renames the enum but doesn't fix the gap. Noted in the plan as a known issue for separate follow-up — no action required here.

### Transaction Safety

PostgreSQL DDL is transactional. TypeORM wraps each migration in a transaction by default. All statements (`ALTER TABLE`, `ALTER TYPE`, `DROP INDEX`, `CREATE INDEX`) are DDL and will roll back atomically on failure. ✅

REVIEW_PASS
