# Plan: Generate clean flat migration

## Context
Replace all 14 incremental migrations with a single idempotent `InitialSchema` migration that creates the final database schema in one pass. This simplifies the migration history — the cumulative result of all renames, column adds, and enum changes is captured as a clean starting point.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Generate and implement the new migration

- [x] **Task 1: Scaffold the new migration file**
  Files: `src/migrations/InitialSchema.ts` (generated)
  Run `npx typeorm migration:create src/migrations/InitialSchema`. This produces a timestamped file with empty `up()` and `down()` stubs. Do not hand-craft the timestamp.

- [x] **Task 2: Implement `up()` — complete schema creation** (depends on Task 1)
  Files: the migration file generated in Task 1
  Use `queryRunner.query()` with raw SQL (matching the existing migration style — no schema-builder API). Wrap the entire body in idempotent guards where appropriate (`CREATE EXTENSION IF NOT EXISTS`, `DO $$ ... IF NOT EXISTS` blocks for enums). The `up()` must create the following objects in dependency order:

  **1. Extension**
  - `uuid-ossp` (`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`)

  **2. Enums** (all four)
  - `users_role_enum` — values: `'user'`, `'admin'`
  - `module_sessions_status_enum` — values: `'active'`, `'disconnected'`, `'completed'`, `'abandoned'`, `'interrupted'`, `'resumed'`
  - `activity_type_enum` — values: `'breath'`
  - `breath_sessions_timeOfDay_enum` — values: `'morning'`, `'midday'`, `'evening'`

  **3. Tables** (in FK-dependency order)

  `users` — uuid PK, `email` varchar NOT NULL UNIQUE (`UQ_users_email`), `name` varchar NOT NULL, `language` varchar(10) NOT NULL DEFAULT `'en'`, `role` `users_role_enum` NOT NULL DEFAULT `'user'`, `createdAt` TIMESTAMP NOT NULL DEFAULT now(), `updatedAt` TIMESTAMP NOT NULL DEFAULT now(). Index: `IDX_users_email`.

  `auth_codes` — uuid PK, `email` varchar NOT NULL, `codeHash` varchar NOT NULL, `createdAt` TIMESTAMP NOT NULL DEFAULT now(), `expiresAt` TIMESTAMP NOT NULL, `used` boolean NOT NULL DEFAULT false. Indices: `IDX_auth_codes_email`, `IDX_auth_codes_code_hash`, `IDX_auth_codes_expires_at`.

  `user_sessions` — uuid PK, `userId` uuid NOT NULL FK → `users(id)` ON DELETE CASCADE, `tokenHash` varchar NOT NULL UNIQUE (`UQ_user_sessions_tokenHash`), `createdAt` TIMESTAMP NOT NULL DEFAULT now(), `lastSeenAt` TIMESTAMP DEFAULT NULL. Indices: `IDX_user_sessions_tokenHash`, `IDX_user_sessions_userId`.

  `devices` — uuid PK, `installation_id` varchar NOT NULL UNIQUE (`UQ_devices_installation_id`), `platform` varchar NOT NULL, `os_version` varchar NOT NULL, `locale` varchar NOT NULL, `timezone` varchar NOT NULL, `screen_width` integer NOT NULL, `screen_height` integer NOT NULL, `app_version` varchar NOT NULL, `build_number` varchar NOT NULL, `model` varchar, `manufacturer` varchar, `last_seen_at` TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_at` TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP. Index: `IDX_devices_last_seen_at` (DESC).

  `breath_sessions` — uuid PK, `userId` uuid NOT NULL FK → `users(id)` ON DELETE CASCADE, `description` text NOT NULL, `exercises` jsonb NOT NULL, `complexity` double precision NOT NULL DEFAULT 0, `shared` boolean NOT NULL DEFAULT false, `timeOfDay` `breath_sessions_timeOfDay_enum` DEFAULT NULL, `createdAt` TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, `deletedAt` TIMESTAMPTZ DEFAULT NULL. Indices: `IDX_breath_sessions_userId`, `IDX_breath_sessions_shared`, `IDX_breath_sessions_createdAt` (DESC), `IDX_breath_sessions_userId_createdAt` composite (DESC), `IDX_breath_sessions_shared_createdAt` composite (DESC). Also create the `update_updated_at_column()` PL/pgSQL function and `BEFORE UPDATE` trigger `update_breath_sessions_updated_at` (same as old migration 1).

  `breath_session_settings` — uuid PK, `userId` uuid NOT NULL FK → `users(id)` ON DELETE CASCADE, `sessionId` uuid NOT NULL FK → `breath_sessions(id)` ON DELETE CASCADE, `starred` boolean NOT NULL DEFAULT false, `createdAt` TIMESTAMP NOT NULL DEFAULT now(), `updatedAt` TIMESTAMP NOT NULL DEFAULT now(). Unique: `UQ_breath_session_settings_user_session` on (`userId`, `sessionId`). Index: `IDX_breath_session_settings_userId_starred` composite.

  `user_stats` — uuid PK, `userId` varchar NOT NULL UNIQUE (`UQ_user_stats_userId`), `totalSessions` integer NOT NULL DEFAULT 0, `totalDurationSeconds` integer NOT NULL DEFAULT 0, `currentStreak` integer NOT NULL DEFAULT 0, `longestStreak` integer NOT NULL DEFAULT 0, `maxCompletedComplexity` double precision NOT NULL DEFAULT 0, `lastSessionDate` date DEFAULT NULL, `updatedAt` TIMESTAMPTZ NOT NULL DEFAULT now().

  `change_events` — `id` SERIAL PRIMARY KEY (not uuid), `entity` varchar NOT NULL, `refId` uuid NOT NULL, `action` varchar NOT NULL, `userId` uuid NOT NULL FK → `users(id)` ON DELETE CASCADE, `createdAt` TIMESTAMP NOT NULL DEFAULT now(). Index: `IDX_change_events_userId_id` composite (`userId`, `id`).

  `personal_access_tokens` — uuid PK, `userId` uuid NOT NULL, `tokenHash` varchar NOT NULL UNIQUE (`UQ_personal_access_tokens_tokenHash`), `name` varchar NOT NULL, `lastUsedAt` TIMESTAMP DEFAULT NULL, `createdAt` TIMESTAMP NOT NULL DEFAULT now(). Index: `IDX_personal_access_tokens_userId`.

  `module_sessions` — uuid PK (`PK_module_sessions_id`), `userId` varchar NOT NULL, `activityType` `activity_type_enum` NOT NULL, `activityRefId` varchar DEFAULT NULL, `status` `module_sessions_status_enum` NOT NULL DEFAULT `'active'`, `startedAt` TIMESTAMP NOT NULL, `disconnectedAt` TIMESTAMPTZ DEFAULT NULL, `endedAt` TIMESTAMP DEFAULT NULL, `lastActivityAt` TIMESTAMP NOT NULL, `metadata` jsonb DEFAULT NULL, `createdAt` TIMESTAMP NOT NULL DEFAULT now(). Indices: `IDX_module_sessions_userId`, `IDX_module_sessions_status`.

  `session_stream_samples` — uuid PK, `moduleSessionId` varchar NOT NULL, `samples` jsonb NOT NULL, `flushedAt` TIMESTAMP NOT NULL, `createdAt` TIMESTAMP NOT NULL DEFAULT now(). Index: `IDX_session_stream_samples_moduleSessionId`.

- [x] **Task 3: Implement `down()` — full teardown in reverse dependency order** (depends on Task 1)
  Files: same migration file from Task 1
  Drop all objects in reverse dependency order using `queryRunner.query()`. Order:
  1. Drop index + table `session_stream_samples`
  2. Drop indices + table `module_sessions`
  3. Drop table `personal_access_tokens`
  4. Drop index + table `change_events`
  5. Drop table `user_stats`
  6. Drop table `breath_session_settings`
  7. Drop trigger `update_breath_sessions_updated_at` on `breath_sessions`, drop function `update_updated_at_column`, drop table `breath_sessions`
  8. Drop table `devices`
  9. Drop table `user_sessions`
  10. Drop table `auth_codes`
  11. Drop table `users`
  12. Drop enums: `breath_sessions_timeOfDay_enum`, `activity_type_enum`, `module_sessions_status_enum`, `users_role_enum`
  13. Drop extension `uuid-ossp`

  Use `DROP TABLE IF EXISTS`, `DROP TYPE IF EXISTS`, `DROP EXTENSION IF EXISTS` for idempotency.

### Phase 2: Remove old migrations

- [x] **Task 4: Delete all existing migration files** (depends on Tasks 1–3)
  Files: `src/migrations/*.ts` (all 14 old files)
  Verify the new migration file from Phase 1 exists and compiles (`npm run build`). Only then delete every old migration file from `src/migrations/`:
  - `1739476800000-InitialSchema.ts`
  - `1773469567000-AddLiveSession.ts`
  - `1773473837884-AddSessionStreamSamples.ts`
  - `1773479812990-AddUserStats.ts`
  - `1773652922852-AddInterruptedSessionStatus.ts`
  - `1773909111537-CreatePersonalAccessTokensTable.ts`
  - `1773909910064-AddTimeOfDayToBreathSessions.ts`
  - `1773945801918-AddMaxCompletedComplexity.ts`
  - `1774011442219-AddSoftDeleteToBreathSessions.ts`
  - `1774011879392-CreateChangeEventsTable.ts`
  - `1774411084222-RenameActivityTypeBreathSessionToBreath.ts`
  - `1774552349945-DropActivityRefTypeFromLiveSessions.ts`
  - `1774778297835-RenameSessionStreamSampleLiveSessionId.ts`
  - `1774779899323-RenameToModuleSessions.ts`

### Phase 3: Reset existing databases

- [x] **Task 5: Reset local development database** (depends on Task 4)
  Files: none (database operation only)
  Existing dev databases have a `migrations` table with 14 entries for the old migration classes, and all tables already exist. The new `InitialSchema` migration uses plain `CREATE TABLE` (not `IF NOT EXISTS`), so TypeORM will fail with `relation already exists` if run against an existing database.

  Reset the database to a clean state so the new migration can run from scratch:
  ```bash
  make db-reset
  ```
  This uses the existing Makefile target which drops and recreates the `mind_database_dev` database via `psql`, then restarts the API container. On restart `migrationsRun: true` runs the new `InitialSchema` migration against an empty database.

  **Note for other developers:** after pulling this change, every developer must run `make db-reset` to drop and recreate their local database. This is a one-time reset — there is no production database to worry about since the project is in early development.

## Commit Plan
- **Commit 1** (after tasks 1-4): "Replace 14 incremental migrations with a single flat InitialSchema migration"
