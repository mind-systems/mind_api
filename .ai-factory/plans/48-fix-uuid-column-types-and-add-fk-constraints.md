# Plan: Fix UUID column types and add FK constraints

## Context
Four columns across `module_sessions`, `session_stream_samples`, and `user_stats` store UUIDs as `character varying` with no FK constraints. Additionally, `personal_access_tokens.userId` already has the correct `uuid` type but is missing a FK constraint entirely. This milestone fixes entity decorators and the `InitialSchema` migration together, adding cascade FKs so user deletion propagates completely — no orphaned rows in any table with a `userId` column.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Entity decorators

- [x] **Task 1: Fix ModuleSession entity column types and comment**
  Files: `src/realtime/entities/module-session.entity.ts`
  Replace the stale comment on lines 18–19 with one that explains the FK lives in the migration:
  ```
  // No @ManyToOne — modules stay decoupled at the ORM level.
  // FK constraint enforced in the InitialSchema migration.
  ```
  Add `type: 'uuid'` to the `userId` column decorator (line 20): `@Column({ type: 'uuid' })`.
  Add `type: 'uuid'` to the `activityRefId` column decorator (line 26): `@Column({ type: 'uuid', nullable: true })`.

- [x] **Task 2: Fix SessionStreamSample entity column type**
  Files: `src/realtime/entities/session-stream-sample.entity.ts`
  Add `type: 'uuid'` to the `moduleSessionId` column decorator (line 15): `@Column({ type: 'uuid' })`.

- [x] **Task 3: Fix UserStats entity column type and comment**
  Files: `src/stats/entities/user-stats.entity.ts`
  Replace the stale comment on line 14 with the same wording as Task 1:
  ```
  // No @ManyToOne — modules stay decoupled at the ORM level.
  // FK constraint enforced in the InitialSchema migration.
  ```
  Add `type: 'uuid'` to the `userId` column decorator (line 16): `@Column({ type: 'uuid' })`.

### Phase 2: InitialSchema migration

- [x] **Task 4: Fix column types and add FK constraints in InitialSchema migration**
  Files: `src/migrations/1774863293946-InitialSchema.ts`
  All changes are in the `up()` method. The `down()` method needs no changes — `DROP TABLE IF EXISTS` in reverse-dependency order already handles cleanup.

  **`user_stats` table** (line 210):
  Change `"userId" character varying NOT NULL` → `"userId" uuid NOT NULL`.
  Add FK constraint inside the CREATE TABLE block:
  ```sql
  CONSTRAINT "FK_user_stats_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
  ```

  **`personal_access_tokens` table** (lines 249–250):
  The `userId` column (line 244) already has the correct `uuid` type — no type change needed.
  Add FK constraint inside the CREATE TABLE block, after the existing UNIQUE constraint on line 250:
  ```sql
  CONSTRAINT "FK_personal_access_tokens_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
  ```
  This closes the last gap: every other table with a `userId` referencing `users` already has `ON DELETE CASCADE`.

  **`module_sessions` table** (lines 261, 263):
  Change `"userId" character varying NOT NULL` → `"userId" uuid NOT NULL`.
  Change `"activityRefId" character varying DEFAULT NULL` → `"activityRefId" uuid DEFAULT NULL`.
  No FK on `activityRefId` — `breath_sessions` rows are independent and outlive module sessions.
  Add FK constraint inside the CREATE TABLE block:
  ```sql
  CONSTRAINT "FK_module_sessions_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
  ```

  **`session_stream_samples` table** (line 285):
  Change `"moduleSessionId" character varying NOT NULL` → `"moduleSessionId" uuid NOT NULL`.
  Add FK constraint inside the CREATE TABLE block:
  ```sql
  CONSTRAINT "FK_session_stream_samples_moduleSessionId" FOREIGN KEY ("moduleSessionId") REFERENCES "module_sessions"("id") ON DELETE CASCADE
  ```
