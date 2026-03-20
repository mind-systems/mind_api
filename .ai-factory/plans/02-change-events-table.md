# Plan: Change Events Table

## Context
Add a `change_events` table and `ChangeLogService` that records entity mutations for sync — downstream consumers (REST poll endpoint, WebSocket push) will use this as the single source of truth.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Entity and Migration

- [x] **Task 1: Create ChangeEvent entity**
  Files: `src/changelog/entities/change-event.entity.ts`
  Create `ChangeEvent` entity decorated with `@Entity('change_events')`:
  - `id` — `@PrimaryGeneratedColumn('increment')` (integer, monotonic cursor)
  - `entity` — `@Column('varchar')`, NOT NULL (e.g. `"breath_session"`)
  - `refId` — `@Column('uuid')`, NOT NULL (PK of the mutated entity)
  - `action` — `@Column('varchar')`, NOT NULL (`"created"` | `"updated"` | `"deleted"`)
  - `userId` — `@Column('uuid')`, NOT NULL (recipient who should see the change)
  - `createdAt` — `@CreateDateColumn()`
  Add `@ManyToOne(() => User, { onDelete: 'CASCADE' })` with `@JoinColumn({ name: 'userId' })` for the FK to `users(id)`.
  Add a composite `@Index(['userId', 'id'])` at class level — this covers the main query pattern `WHERE userId = ? AND id > ? ORDER BY id`.

- [x] **Task 2: Create migration for change_events table** (depends on Task 1)
  Files: `src/migrations/<timestamp>-CreateChangeEventsTable.ts`
  Generate the migration file via CLI (`npx typeorm migration:create src/migrations/CreateChangeEventsTable`). Fill `up()` with raw SQL:
  - `CREATE TABLE "change_events"` with columns matching the entity: `id SERIAL PRIMARY KEY`, `entity VARCHAR NOT NULL`, `"refId" UUID NOT NULL`, `action VARCHAR NOT NULL`, `"userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `"createdAt" TIMESTAMP NOT NULL DEFAULT now()`
  - `CREATE INDEX "IDX_change_events_userId_id" ON "change_events" ("userId", "id")`
  `down()` drops the table.
  Follow the exact style from `CreatePersonalAccessTokensTable` migration (class has `name` property, raw SQL via `queryRunner.query`).

### Phase 2: Service and Module

- [x] **Task 3: Create ChangeLogService** (depends on Task 1)
  Files: `src/changelog/changelog.service.ts`
  Injectable service with `@InjectRepository(ChangeEvent)`. Methods:
  - `log(entity: string, refId: string, action: string, userId: string)` — inserts one row
  - `logForRecipients(entity: string, refId: string, action: string, userIds: string[])` — inserts N rows (one per recipient), use a single `INSERT ... VALUES` with multiple value tuples for efficiency
  - `getChanges(userId: string, afterId: number, limit = 100)` — `SELECT ... WHERE userId = :userId AND id > :afterId ORDER BY id LIMIT :limit+1`; return `{ events, cursor, hasMore }` (fetch limit+1 to detect `hasMore`, return at most `limit` rows)
  - `getMinEventId()` — `SELECT MIN(id) FROM change_events`; returns `number | null`
  - `purge(olderThanDays = 30)` — `DELETE FROM change_events WHERE createdAt < now() - interval '...'`; decorate with `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)` so it runs daily automatically

- [x] **Task 4: Create ChangelogModule** (depends on Task 3)
  Files: `src/changelog/changelog.module.ts`, `src/app.module.ts`
  Create a `@Global()` module so any feature module can inject `ChangeLogService` without explicit import (same rationale as MailModule — it's cross-cutting infrastructure).
  - `imports: [TypeOrmModule.forFeature([ChangeEvent])]`
  - `providers: [ChangeLogService]`
  - `exports: [ChangeLogService]`
  Register `ChangelogModule` in `AppModule.imports`.

## Commit Plan
- **Commit 1** (after tasks 1-2): "Add change_events table and migration"
- **Commit 2** (after tasks 3-4): "Add ChangeLogService with log, query, and purge methods"
