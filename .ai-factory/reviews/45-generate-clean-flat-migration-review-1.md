## Code Review: Generate clean flat migration

**Files Reviewed:** 15 (1 new migration, 14 deleted migrations)
**Risk Level:** 🟡 Medium

### Context Gates

- **ARCHITECTURE.md** — WARN: no issues. Migration uses raw SQL via `queryRunner.query()` consistent with documented migration style. `synchronize: false` preserved.
- **RULES.md** — WARN: no issues. Migration file contains no logging or sensitive data.
- **ROADMAP.md** — OK: milestone 9.1 "Flatten migration history" is checked off. Commit aligns with roadmap item.

### Schema Verification

Cross-checked every column, type, default, constraint, index, enum, FK, and trigger in `src/migrations/1774863293946-InitialSchema.ts` against all 11 entity files and 4 enum files. Build passes (`npx tsc --noEmit` — zero errors).

| Table | Verdict |
|-------|---------|
| `users` | OK |
| `auth_codes` | OK |
| `user_sessions` | OK |
| `devices` | OK |
| `breath_sessions` | **Type mismatch** — see below |
| `breath_session_settings` | OK |
| `user_stats` | OK |
| `change_events` | OK |
| `personal_access_tokens` | OK |
| `module_sessions` | OK |
| `session_stream_samples` | OK |

| Enum | Verdict |
|------|---------|
| `users_role_enum` | OK — `user`, `admin` |
| `module_sessions_status_enum` | OK — all 6 values |
| `activity_type_enum` | OK — `breath` |
| `breath_sessions_timeOfDay_enum` | OK — `morning`, `midday`, `evening` |

**Dependency order** (up: FK targets before referencing tables, down: reverse) — verified correct.
**Idempotency** — extension uses `IF NOT EXISTS`, enums use PL/pgSQL exception handler — correct.
**Migration discovery** — both `src/config/typeorm.config.ts` (`'src/migrations/*.ts'`) and `database.config.ts` (`__dirname + '/src/migrations/*{.ts,.js}'`) glob patterns match the single migration file.

### Critical Issues

None.

### Suggestions

**`breath_sessions`: TIMESTAMPTZ vs TIMESTAMP mismatch** (lines 145–147 of migration)

The migration creates `createdAt`, `updatedAt`, and `deletedAt` as `TIMESTAMP WITH TIME ZONE`, but the `BreathSession` entity uses bare `@CreateDateColumn()`, `@UpdateDateColumn()`, and `@DeleteDateColumn()` without specifying `type: 'timestamptz'`. TypeORM's default for these decorators on PostgreSQL is `TIMESTAMP WITHOUT TIME ZONE`.

Every other table with untyped `@CreateDateColumn()` in its entity (`users`, `auth_codes`, `user_sessions`, `breath_session_settings`, `change_events`, `personal_access_tokens`, `module_sessions`, `session_stream_samples`) correctly uses `TIMESTAMP` in the migration. Tables that explicitly specify `type: 'timestamptz'` in the entity (`devices.created_at`, `user_stats.updatedAt`, `module_sessions.disconnectedAt`) correctly use `TIMESTAMPTZ` in the migration.

`breath_sessions` is the only table where the migration uses `TIMESTAMPTZ` but the entity doesn't request it.

This won't cause runtime errors with `synchronize: false`, but it's a latent type inconsistency. Fix either side:
- **Option A** (align migration to entity): change the three columns to `TIMESTAMP NOT NULL DEFAULT now()` / `TIMESTAMP DEFAULT NULL`
- **Option B** (align entity to migration): add `type: 'timestamptz'` to the three decorators in `breath-session.entity.ts`

### Positive Notes

- Correctly fixes three historical bugs from the old migration chain: missing `interrupted`/`resumed` enum values and `disconnectedAt` type mismatch
- Clean idempotent enum creation using PL/pgSQL exception handler
- `down()` teardown is thorough — drops indices, triggers, functions, tables, enums, and extension in correct reverse order
- Well-structured code with clear section comments
