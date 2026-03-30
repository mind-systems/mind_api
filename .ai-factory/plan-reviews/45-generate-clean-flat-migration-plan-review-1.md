## Plan Review: Generate clean flat migration

**Plan:** `.ai-factory/plans/45-generate-clean-flat-migration.md`
**Files Reviewed:** 14 migration files, 11 entity files, 2 TypeORM configs, ROADMAP, RULES, ARCHITECTURE, feedback memory
**Risk Level:** 🟡 Medium

### Context Gates

- **ARCHITECTURE.md** — WARN: no violations. Plan uses raw SQL via `queryRunner.query()` matching the established migration style. `synchronize: false` rule respected.
- **RULES.md** — WARN: not directly applicable (no application code in migrations). No sensitive data exposure.
- **ROADMAP.md** — WARN: Phase 9.1 lists "Generate clean flat migration" before "Delete all 14 existing migration files." The plan reverses this order (see Critical Issue 1).

### Critical Issues

**1. Phase ordering violates project rule: "never delete before replacement is ready"**

The plan's Phase 1 deletes all 14 migration files, then Phase 2 scaffolds and implements the new one. This directly contradicts:

- `feedback_migrations.md` memory rule: *"when regenerating a file, never delete the original before the replacement is ready. Create the new file first, transfer content, then remove the old one."*
- ROADMAP Phase 9.1 ordering: generate first, delete second.

If implementation is interrupted between Phase 1 and Phase 2, all migration source code is gone with no replacement in place.

**Fix:** Swap the phases — scaffold and implement the new `InitialSchema` migration first (current Phase 2), verify it compiles, then delete the 14 old files (current Phase 1).

---

**2. Missing step: database reset for existing dev environments**

Both TypeORM configs use `migrationsRun: true` and track executed migrations in the `migrations` table. After this change:

- The `migrations` table still contains 14 entries for the old migration classes.
- TypeORM sees the new `InitialSchema` migration as "pending" and attempts to run it.
- Tables, enums, and the extension already exist in the database. The plan uses plain `CREATE TABLE` (without `IF NOT EXISTS`), so the migration will fail with `relation "users" already exists`.

The plan must include a step for handling existing databases. Options:
- `TRUNCATE migrations; DROP SCHEMA public CASCADE; CREATE SCHEMA public;` then re-run migrations.
- Or at minimum: document that developers must drop and recreate their local database after this change.

Without this, every developer (and Docker dev environment) will hit a broken migration on next startup.

### Suggestions

**3. Timestamp columns inconsistently missing `NOT NULL`**

The plan describes `createdAt`/`updatedAt` as `TIMESTAMP DEFAULT now()` on most tables, dropping the `NOT NULL` constraint present in every original migration. Only `user_stats.updatedAt` retains `NOT NULL`.

Affected tables: `users`, `auth_codes`, `user_sessions`, `breath_session_settings`, `module_sessions`, `session_stream_samples`, `personal_access_tokens`, `change_events`.

Original migration example (`users`):
```sql
"createdAt"  TIMESTAMP NOT NULL DEFAULT now()
```

Plan:
```
createdAt TIMESTAMP DEFAULT now()
```

Without `NOT NULL`, an explicit `INSERT ... (createdAt) VALUES (NULL)` would succeed, weakening schema integrity. Every `@CreateDateColumn()` / `@UpdateDateColumn()` in the entities implies NOT NULL.

**Fix:** Add `NOT NULL` to every `createdAt` and `updatedAt` column spec in the plan.

### Positive Notes

- The plan correctly captures the cumulative final schema from all 14 migrations — every table, column, index, FK, enum, and trigger was verified against the source entities and migrations.
- The flatten fixes a real bug in the existing migration chain: `AddInterruptedSessionStatus` checks for `live_sessions_status_enum` but the enum was actually named `session_status_enum`, so `interrupted` and `resumed` were never added to the DB enum. The flat migration creates the enum correctly with all 6 values.
- Idempotent guards for the extension and enums (`IF NOT EXISTS`, `DO $$ ... IF NOT EXISTS`) are appropriate — enums fail silently on `CREATE TYPE` without guards.
- The `down()` teardown order correctly respects FK dependencies — all child tables are dropped before parent tables.
- Using `queryRunner.query()` with raw SQL is consistent with the existing migration style (no schema-builder API).
- Plan correctly follows the CLI-only rule for migration scaffolding (`npx typeorm migration:create`).
