# Plan: Fix UUID Types in Migrations & Entities (Phase 11)

## Context
Four columns across three tables (`module_sessions`, `session_stream_samples`, `user_stats`) store UUIDs as `character varying` with no FK constraints. This plan fixes all four entity decorators, updates stale comments, and corrects the `InitialSchema` migration to use proper `uuid` types with FK constraints — keeping entities and migration in sync.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Fix entity column decorators

- [ ] **Task 1: Fix `ModuleSession.userId` decorator**
  Files: `src/realtime/entities/module-session.entity.ts`
  On line 20, change `@Column()` to `@Column({ type: 'uuid' })`. This aligns the TypeORM metadata with the corrected migration (Task 6).

- [ ] **Task 2: Fix `ModuleSession.activityRefId` decorator**
  Files: `src/realtime/entities/module-session.entity.ts`
  On line 26, change `@Column({ nullable: true })` to `@Column({ type: 'uuid', nullable: true })`.

- [ ] **Task 3: Fix `SessionStreamSample.moduleSessionId` decorator**
  Files: `src/realtime/entities/session-stream-sample.entity.ts`
  On line 15, change `@Column()` to `@Column({ type: 'uuid' })`.

- [ ] **Task 4: Fix `UserStats.userId` decorator**
  Files: `src/stats/entities/user-stats.entity.ts`
  On line 16, change `@Column()` to `@Column({ type: 'uuid' })`.

### Phase 2: Update stale entity comments

- [ ] **Task 5: Replace stale comments in both entity files**
  Files: `src/realtime/entities/module-session.entity.ts`, `src/stats/entities/user-stats.entity.ts`

  In `module-session.entity.ts` (lines 18–19), replace:
  ```
  // No @ManyToOne FK to User — intentional loose coupling between realtime and users modules.
  // Integrity is enforced at the service layer (userId comes from validated JWT).
  ```
  with:
  ```
  // No @ManyToOne — modules stay decoupled at the ORM level.
  // FK constraint enforced in the InitialSchema migration.
  ```

  In `user-stats.entity.ts` (line 14), replace:
  ```
  // No FK to users — intentional loose coupling, same pattern as ModuleSession
  ```
  with:
  ```
  // No @ManyToOne — modules stay decoupled at the ORM level.
  // FK constraint enforced in the InitialSchema migration.
  ```

### Phase 3: Fix InitialSchema migration

- [ ] **Task 6: Fix column types and add FK constraints in InitialSchema** (depends on Tasks 1–4)
  Files: `src/migrations/1774863293946-InitialSchema.ts`

  In the `module_sessions` CREATE TABLE block (lines 258–273):
  - Line 261: change `"userId" character varying NOT NULL` to `"userId" uuid NOT NULL`
  - Line 263: change `"activityRefId" character varying DEFAULT NULL` to `"activityRefId" uuid DEFAULT NULL`
  - After the `CONSTRAINT "PK_module_sessions_id"` line (line 271), add:
    ```sql
    CONSTRAINT "FK_module_sessions_userId"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    ```
    (add a comma after the PK constraint to separate them)

  In the `session_stream_samples` CREATE TABLE block (lines 282–291):
  - Line 285: change `"moduleSessionId" character varying NOT NULL` to `"moduleSessionId" uuid NOT NULL`
  - After the `CONSTRAINT "PK_session_stream_samples_id"` line (line 289), add:
    ```sql
    CONSTRAINT "FK_session_stream_samples_moduleSessionId"
      FOREIGN KEY ("moduleSessionId") REFERENCES "module_sessions"("id") ON DELETE CASCADE
    ```
    (add a comma after the PK constraint to separate them)

  In the `user_stats` CREATE TABLE block (lines 207–221):
  - Line 210: change `"userId" character varying NOT NULL` to `"userId" uuid NOT NULL`
  - After the `CONSTRAINT "UQ_user_stats_userId" UNIQUE ("userId")` line (line 219), add:
    ```sql
    CONSTRAINT "FK_user_stats_userId"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    ```
    (add a comma after the UQ constraint to separate them)

- [ ] **Task 7: Verify `down()` method handles new FK constraints**
  Files: `src/migrations/1774863293946-InitialSchema.ts`
  Review the `down()` method. The existing drop order is already correct: `session_stream_samples` → `module_sessions` → ... → `user_stats` → ... → `users`. All tables with new FK references to `users` or `module_sessions` are dropped before their parent tables. No changes needed — just verify and confirm.

## Commit Plan
- **Commit 1** (after tasks 1–5): "Fix uuid type decorators and update stale comments in realtime and stats entities"
- **Commit 2** (after tasks 6–7): "Fix InitialSchema migration: varchar to uuid columns with FK constraints"
