# Plan: Add `rootSessionId` + `root` activity type with migration

## Context
Lay the additive schema foundation for the continuous-bio-timeline refactor: a new server-internal `root` activity type and a nullable self-referencing `rootSessionId` link on `module_sessions`. Purely additive — compiles, changes no runtime behavior, leaves all existing rows valid.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Type + entity + interface

- [x] **Task 1: Add `ROOT` member to the `ActivityType` TS enum**
  Files: `src/realtime/enums/activity-type.enum.ts`
  Add `ROOT = 'root',` to the enum (current members: `BREATH = 'breath'`, `MEDITATION = 'meditation'`). Do NOT touch `proto/module_state.proto` — `root` is a server-internal discriminator and `mapProtoActivityType` must keep throwing on any non-breath/meditation value.

- [x] **Task 2: Add nullable `rootSessionId` column + index to `ModuleSession`** (depends on Task 1)
  Files: `src/realtime/entities/module-session.entity.ts`
  After the `userId` column (line 20-21), mirroring the existing nullable-uuid `activityRefId` shape, add:
  ```ts
  // No @ManyToOne — modules stay decoupled at the ORM level (mirrors userId).
  // Self-referential FK constraint enforced in the migration, not via @ManyToOne.
  @Column({ type: 'uuid', nullable: true })
  rootSessionId: string | null;
  ```
  Add a class-level `@Index(['rootSessionId'])` next to the existing `@Index(['userId'])` / `@Index(['status'])` (lines 12-13). A plain `@Column` (not `@ManyToOne`) means TypeORM will NOT emit the self-FK — the FK is written explicitly in the migration (Task 5).

- [x] **Task 3: Add optional `rootSessionId` to `ActivityState` interface** (depends on Task 1)
  Files: `src/realtime/interfaces/activity-state.interface.ts`
  Add `rootSessionId?: string | null;` to the interface so the later store/engine and lazy-root work can carry the link in memory. Purely additive — no runtime change in this phase.

### Phase 2: Migrations

- [x] **Task 4: Migration — extend the Postgres enum type with `'root'`** (depends on Task 1)
  Files: `src/migrations/<generated-timestamp>-AddRootActivityType.ts`
  Generate via CLI (never hand-craft the timestamp):
  ```bash
  npx typeorm migration:create src/migrations/AddRootActivityType
  ```
  This migration does ONLY the enum extension and nothing else — `ALTER TYPE ... ADD VALUE` is allowed inside a transaction on PG 12+ only if the new value is not used in the same transaction, so it must not share a tx with any write of a `'root'` row. The enum type name is `"public"."activity_type_enum"`.
  `up()`:
  ```sql
  ALTER TYPE "public"."activity_type_enum" ADD VALUE IF NOT EXISTS 'root'
  ```
  `down()` must reject with an `Error` (Postgres has no `DROP VALUE`) — copy the exact reject pattern from `src/migrations/1780146744056-AddMeditationActivityType.ts` (lines 10-22), adjusting the message to reference root.

- [x] **Task 5: Migration — add `rootSessionId` column, self-FK, and index** (depends on Task 4)
  Files: `src/migrations/<generated-timestamp>-AddRootSessionLink.ts`
  Generate via CLI (keep this separate from Task 4's migration so the enum-add tx is clean; its timestamp must sort AFTER Task 4's):
  ```bash
  npx typeorm migration:create src/migrations/AddRootSessionLink
  ```
  `up()` — raw SQL matching the InitialSchema style:
  ```sql
  ALTER TABLE "module_sessions" ADD COLUMN "rootSessionId" uuid DEFAULT NULL;
  ALTER TABLE "module_sessions"
    ADD CONSTRAINT "FK_module_sessions_rootSessionId"
    FOREIGN KEY ("rootSessionId") REFERENCES "module_sessions"("id") ON DELETE CASCADE;
  CREATE INDEX "IDX_module_sessions_rootSessionId" ON "module_sessions" ("rootSessionId");
  ```
  `down()` — reverse in dependency order: `DROP INDEX "IDX_module_sessions_rootSessionId"`, `ALTER TABLE "module_sessions" DROP CONSTRAINT "FK_module_sessions_rootSessionId"`, `ALTER TABLE "module_sessions" DROP COLUMN "rootSessionId"`.
  Index/constraint names follow the existing `IDX_module_sessions_<col>` / `FK_module_sessions_<col>` conventions. Nullable column → all existing rows stay valid; do NOT write or backfill any `'root'` rows here (the 1:1 backfill is a later phase).

### Phase 3: Verify

- [x] **Task 6: Build and migration round-trip check** (depends on Tasks 1-5)
  Files: (no source changes)
  Run `npm run build` to confirm the TS enum, entity column, and interface field all compile. Run `npm run migration:run` then `npm run migration:revert` (twice, to roll back both migrations) and confirm clean up/down — noting that the enum-add migration's `down()` is expected to reject by design (revert it manually / acknowledge the loud failure). Sanity-check that existing rows have `rootSessionId IS NULL` and that a row with `activityType = 'root'` plus a child referencing it can be inserted.

## Commit Plan
- **Commit 1** (after tasks 1-6): "Add root activity type and rootSessionId link to module sessions"

All six tasks form one atomic, additive schema foundation — the entity column and its migration must deploy together, so they ship as a single commit.
