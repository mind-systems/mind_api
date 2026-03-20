# Review: Soft Delete for Breath Sessions

## Files reviewed

| File | Verdict |
|------|---------|
| `src/migrations/1774011442219-AddSoftDeleteToBreathSessions.ts` | OK |
| `src/breath-sessions/entities/breath-session.entity.ts` | OK |
| `src/breath-sessions/breath-sessions.service.ts` | OK |
| `src/stats/stats.service.ts` | OK |

## Migration

`ALTER TABLE "breath_sessions" ADD COLUMN "deletedAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL` — correct type matching TypeORM's `@DeleteDateColumn()` output. `down()` drops the column cleanly. Timestamp (`1774011442219`) is higher than the previous migration (`1773945801918`), so ordering is correct. Migration is auto-discovered via `src/migrations/*.ts` glob in `typeorm.config.ts`.

## Entity

`@DeleteDateColumn()` is placed after `updatedAt` — consistent with the temporal column grouping. TypeORM will automatically append `WHERE "deletedAt" IS NULL` to all `find*()` and `repository.createQueryBuilder()` calls on this entity. The `@ApiProperty({ example: null, nullable: true })` exposes the field in Swagger. This is an additive API contract change — existing clients will see a new `deletedAt: null` field in every response. Not breaking but worth noting for mobile release coordination.

## Service — `remove()`

`softRemove(session)` sets `deletedAt = now()` and persists via UPDATE. The preceding `findOne({ where: { id } })` auto-filters soft-deleted rows, so double-deletion is naturally prevented (returns 404). Return type `Promise<void>` is fine — the discarded return value of `softRemove` is not needed since the controller returns `{ message: '...' }`.

## StatsService raw SQL

`AND "deletedAt" IS NULL` correctly added to the raw `manager.query()` call which bypasses TypeORM's auto-filtering. This prevents complexity lookups against soft-deleted sessions.

## QueryBuilder coverage

- `findList` (authenticated): uses `this.breathSessionRepository.createQueryBuilder('session')` — TypeORM auto-filters soft-deleted rows on the `session` alias.
- `findSuggestions`: same pattern — auto-filtered.
- `findList` (unauthenticated): uses `findAndCount()` — auto-filtered.
- `findOne`, `update`, `replace`: use `findOne()` — auto-filtered.

All query paths correctly exclude soft-deleted rows without manual WHERE clauses.

## Notes (non-blocking)

1. **Orphaned settings rows.** `BreathSessionSettings` has `onDelete: CASCADE` referencing `breath_sessions`. Soft delete never triggers the DB cascade, so settings for soft-deleted sessions will remain. Not a bug — functionally invisible since they're only accessed via session-scoped lookups. If storage matters long-term, a cleanup job can handle this.

2. **Seed script entity divergence.** `src/scripts/seed-breath-sessions.ts` defines its own inline `BreathSession` entity without `deletedAt`. No runtime impact — the column is nullable with DEFAULT NULL, so INSERTs without it succeed. But the entity is now out of sync with the real schema.

REVIEW_PASS
