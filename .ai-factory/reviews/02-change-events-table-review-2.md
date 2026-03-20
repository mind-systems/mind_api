# Review 2: 02 — Change Events Table

## Files reviewed

- `src/changelog/entities/change-event.entity.ts`
- `src/changelog/changelog.service.ts`
- `src/changelog/changelog.module.ts`
- `src/migrations/1774011879392-CreateChangeEventsTable.ts`
- `src/app.module.ts`

## Review-1 issues — status

Both issues from review-1 have been fixed. `purge()` now uses TypeORM's delete query builder with parameterized `make_interval(days => :days)`, returning `DeleteResult.affected` for accurate logging.

## Analysis

**Entity ↔ migration consistency** — all columns, types, nullability, FK, and index match between `change-event.entity.ts` and the migration DDL. The `DEFAULT now()` on `createdAt` covers the raw SQL path in `logForRecipients`; TypeORM's `@CreateDateColumn` covers the ORM path in `log()`.

**`logForRecipients`** — positional params `$1..$N*4` are correctly computed. Each value tuple references the right positions. Empty-array guard prevents a malformed query. All values are parameterized — no injection risk.

**`getChanges`** — cursor pagination via limit+1 is correct. `.limit()` (vs `.take()`) is fine for a single-table query with no joins. Cursor falls back to `afterId` when no events are returned, so the caller can retry without losing their position.

**`getMinEventId`** — `MIN(id)` returns `NULL` on empty table; the `!= null` guard and `parseInt` conversion handle this correctly.

**`purge`** — `make_interval(days => :days)` is a valid PostgreSQL function call with a named argument, correctly parameterized by the query builder. `DeleteResult.affected` gives the actual row count. Matches the existing cron pattern in `auth-code.service.ts`.

**Module wiring** — `@Global()` on `ChangelogModule` is appropriate (same rationale as `MailModule`). `ScheduleModule.forRoot()` is already registered in `AppModule`, so `@Cron` decorators work. Entity glob in `typeorm.config.ts` (`src/**/*.entity.ts`) picks up the new entity automatically.

**Migration ordering** — timestamp `1774011879392` is after the latest existing migration (`1774011442219`). The `users` table (referenced by FK) is created in the initial schema migration. No ordering issues.

## Verdict

No issues found. The previous review's concerns have been addressed.

REVIEW_PASS
