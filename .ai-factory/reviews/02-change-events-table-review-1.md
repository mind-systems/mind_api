# Review: 02 — Change Events Table

## Files reviewed

- `src/changelog/entities/change-event.entity.ts`
- `src/changelog/changelog.service.ts`
- `src/changelog/changelog.module.ts`
- `src/migrations/1774011879392-CreateChangeEventsTable.ts`
- `src/app.module.ts`

---

## Issues

### 1. SQL injection in `purge()` — `changelog.service.ts:86`

`olderThanDays` is interpolated directly into the SQL string:

```typescript
`DELETE FROM "change_events" WHERE "createdAt" < now() - interval '${olderThanDays} days'`
```

TypeScript's `number` type is compile-time only. At runtime nothing prevents a caller from passing a string. PostgreSQL's `query()` supports multi-statement execution, so a crafted value could escape the interval literal.

**Fix:** use `make_interval()` with a positional parameter:

```typescript
`DELETE FROM "change_events" WHERE "createdAt" < now() - make_interval(days => $1)`,
[olderThanDays],
```

### 2. `purge()` always logs "removed 0" — `changelog.service.ts:88`

`this.changeEventRepo.query()` for a DELETE on PostgreSQL returns the raw `pg` result rows (an empty array `[]`), not a `[rows, count]` tuple. So `result[1] ?? 0` is always `undefined ?? 0 = 0`.

The existing cron cleanup in `auth-code.service.ts:151` uses `this.authCodeRepository.delete(...)` which returns `DeleteResult.affected`. Follow the same pattern:

```typescript
const result = await this.changeEventRepo
  .createQueryBuilder()
  .delete()
  .where('"createdAt" < now() - make_interval(days => :days)', { days: olderThanDays })
  .execute();

this.logger.log(`purge: removed ${result.affected ?? 0} change events older than ${olderThanDays} days`);
```

This also fixes issue #1 since the query builder parameterizes `:days`.

---

## Observations (non-blocking)

- Entity and migration are consistent — columns, types, index, FK all match.
- `logForRecipients` correctly parameterizes all values via `$N` positional params. The early return on empty array is correct.
- `getChanges` cursor pagination (fetch limit+1, slice) is standard and correct.
- `getMinEventId` correctly handles the empty-table case (`MIN` returns `NULL`, guarded by `!= null`).
- `@Global()` on `ChangelogModule` is appropriate — same pattern as `MailModule` for cross-cutting infrastructure.
- `@Index(['userId', 'id'])` on the entity is documentation-only since `synchronize: false`; the actual index is created by the migration. Both are present and consistent.

---

## Verdict

Two issues in `purge()` — SQL injection and wrong affected-row count. Both are in the same method and can be fixed together by switching from raw `query()` to TypeORM's `delete()` query builder (matching the existing `auth-code.service.ts` pattern).
