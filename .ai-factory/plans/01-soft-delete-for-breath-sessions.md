# Plan: Soft Delete for Breath Sessions

## Context
Replace hard deletion of breath sessions with soft delete — add a nullable `deletedAt` timestamp column and use TypeORM's `@DeleteDateColumn` so all standard queries automatically exclude soft-deleted rows.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Database schema

- [x] **Task 1: Create migration to add `deletedAt` column**
  Files: `src/migrations/<timestamp>-AddSoftDeleteToBreathSessions.ts`
  Generate the migration file via CLI (`npx typeorm migration:create src/migrations/AddSoftDeleteToBreathSessions`). In `up()`: `ALTER TABLE "breath_sessions" ADD COLUMN "deletedAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL`. In `down()`: drop the column. Follow the existing migration pattern — raw SQL via `queryRunner.query()` (see `AddMaxCompletedComplexity` migration for reference).

### Phase 2: Entity and service

- [x] **Task 2: Add `@DeleteDateColumn` to the entity** (depends on Task 1)
  Files: `src/breath-sessions/entities/breath-session.entity.ts`
  Import `DeleteDateColumn` from `typeorm`. Add a `deletedAt: Date | null` field decorated with `@DeleteDateColumn()` and `@ApiProperty({ example: null, nullable: true })`. Place it after the existing `updatedAt` field. TypeORM will automatically add `WHERE "deletedAt" IS NULL` to all `find*()` calls and `createQueryBuilder()` queries on this repository — no changes needed in `findList`, `findOne`, `findSuggestions`, `update`, or `replace`.

- [x] **Task 3: Switch `remove()` to soft delete** (depends on Task 2)
  Files: `src/breath-sessions/breath-sessions.service.ts`
  In the `remove()` method, replace `this.breathSessionRepository.remove(session)` with `this.breathSessionRepository.softRemove(session)`. This sets `deletedAt = now()` instead of physically deleting the row. No other changes needed in this file — TypeORM's `@DeleteDateColumn` ensures all existing queries already filter out soft-deleted rows.

- [x] **Task 4: Filter soft-deleted rows in StatsService raw SQL** (depends on Task 2)
  Files: `src/stats/stats.service.ts`
  The raw SQL query `SELECT complexity FROM breath_sessions WHERE id = $1` (around line 101-102) bypasses TypeORM's automatic soft-delete filtering. Add `AND "deletedAt" IS NULL` to the WHERE clause so completed-session complexity lookups skip soft-deleted sessions.
