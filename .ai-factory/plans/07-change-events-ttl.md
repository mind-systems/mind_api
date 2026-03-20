# Plan: Change Events TTL

## Context

Move the daily purge cron from `ChangelogModule` (low-level event recording layer) to `SyncModule` (sync domain that owns the TTL policy). The `purge()` method and `getMinEventId()` already exist in `ChangeLogService` — this milestone relocates the scheduling responsibility to where it architecturally belongs. When old events are purged, `SyncService.getChanges()` already detects stale cursors via `getMinEventId()` and responds with `{ fullResync: true }`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Move purge cron to SyncModule

- [x] **Task 1: Remove @Cron decorator from ChangeLogService.purge()**
  Files: `src/changelog/changelog.service.ts`
  Remove the `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)` decorator from the `purge()` method — keep the method itself as a plain public method so it can be called by `SyncService`. Remove the `Cron` and `CronExpression` imports from `@nestjs/schedule` (no other method in this file uses them).

- [x] **Task 2: Add daily purge cron to SyncService** (depends on Task 1)
  Files: `src/sync/sync.service.ts`
  Add a `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)` method that delegates to `this.changeLogService.purge()`. Add a `Logger` instance (follows the pattern in `ChangeLogService` and `AuthCodeService`). Import `Cron`, `CronExpression` from `@nestjs/schedule`. The method should log the completion — reuse the same log line format that `purge()` currently uses, or let `purge()` handle its own logging and keep the cron wrapper silent.
