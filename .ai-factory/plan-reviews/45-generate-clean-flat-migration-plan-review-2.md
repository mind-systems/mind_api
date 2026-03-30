## Plan Review Summary

**Plan:** 45-generate-clean-flat-migration.md
**Files Reviewed:** 14 migration files, 11 entity files, database.config.ts, typeorm.config.ts, docker-compose.dev.yml, Makefile, app.module.ts
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md** — WARN: no conflict. The plan is a migration-only change, touches no module boundaries or dependency rules.
- **RULES.md** — WARN: no conflict. No application code is being written — rules about non-null assertions and logging are not applicable.
- **ROADMAP.md** — OK: Plan directly implements Phase 9.1 ("Flatten migration history"). The roadmap item and plan are fully aligned.

### Schema Verification

Every table, column, type, default, constraint, index, enum, trigger, and FK was cross-checked against the 14 existing migrations (cumulative final state) and the current entity definitions. Results:

| Object | Verdict | Notes |
|--------|---------|-------|
| `users` | ✅ | Columns, PK, UQ, index match |
| `auth_codes` | ✅ | Columns, PK, 3 indices match |
| `user_sessions` | ✅ | Columns, PK, UQ, FK, 2 indices match |
| `devices` | ✅ | Columns, PK, UQ, DESC index match |
| `breath_sessions` | ✅ | Columns, PK, FK, 5 indices, trigger/function match |
| `breath_session_settings` | ✅ | Columns, PK, FKs, UQ composite, index match |
| `user_stats` | ✅ | Columns, PK, UQ on userId match |
| `change_events` | ✅ | SERIAL PK, FK, composite index match |
| `personal_access_tokens` | ✅ | Columns, PK, UQ, index match; no FK — intentional |
| `module_sessions` | ✅ | Columns, PK (named), 2 indices match; no FK — intentional |
| `session_stream_samples` | ✅ | Columns, PK, index match; no FK |
| `users_role_enum` | ✅ | `user`, `admin` |
| `module_sessions_status_enum` | ✅ | All 6 values including `interrupted`, `resumed` |
| `activity_type_enum` | ✅ | `breath` (post-rename value) |
| `breath_sessions_timeOfDay_enum` | ✅ | `morning`, `midday`, `evening` |

The plan also implicitly fixes two real bugs in the old migration chain:
- `interrupted` was never actually added to the DB enum (the `AddInterruptedSessionStatus` migration checked for `live_sessions_status_enum` which didn't exist — the enum was named `session_status_enum` at that point).
- `resumed` exists in the TypeScript enum but was never added via any migration.
- `disconnectedAt` in `module_sessions` was created as `TIMESTAMP` but the entity expects `TIMESTAMPTZ` — the flat migration uses `TIMESTAMPTZ`, matching the entity.

### Dependency Order

**`up()` creation order** — verified: tables are created after all their FK targets exist. `users` first, then tables referencing it, then tables referencing those.

**`down()` teardown order** — verified: all 13 steps respect reverse FK dependencies. No table is dropped while another table still holds an FK reference to it.

### Migration File List

All 14 files listed in Task 4 match the actual files found in `src/migrations/`. None missing, none extra.

### Critical Issues

None.

### Suggestions

**Task 5: Wrong Docker volume name.** The plan says:
```bash
docker volume rm mind_api_postgres_data || true
```
The actual volume is `mind_api_database_dev_volume` (compose volume `database_dev_volume` + project prefix `mind_api`). The `|| true` will silently swallow the "volume not found" error, leaving the old database intact. The subsequent `make up` will then fail with `relation "users" already exists` when the new migration runs.

Fix — use the existing `make db-reset` Makefile target, which drops and recreates the database without needing to know the volume name:
```bash
make db-reset
```
This already does exactly what Task 5 needs: drops the database, recreates it empty, and restarts the API container (which triggers `migrationsRun: true`).

If volume removal is preferred (e.g. to reclaim disk), use the correct name:
```bash
make down
docker volume rm mind_api_database_dev_volume || true
make up
```

### Positive Notes

- The schema specification is remarkably thorough — every column type, default, constraint name, and index is documented, which will make implementation straightforward with minimal guesswork.
- Correct use of `CREATE EXTENSION IF NOT EXISTS` and `DO $$ ... IF NOT EXISTS` guards for enums, while intentionally using plain `CREATE TABLE` for tables (since a fresh database is required).
- The plan correctly identifies that `module_sessions.userId` is `varchar` (not `uuid`) and that `user_stats`, `module_sessions`, and `personal_access_tokens` intentionally have no FK to `users` — matching the entity design decisions.
- Fixing the broken `interrupted`/`resumed` enum values and the `disconnectedAt` type mismatch as a side effect of flattening is a clean win.
- The commit plan is appropriately atomic — single commit after all tasks, not one per task.
