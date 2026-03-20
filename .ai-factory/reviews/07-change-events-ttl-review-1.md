# Review: Change Events TTL

## Files changed
- `src/changelog/changelog.service.ts` — removed `@Cron` decorator and `@nestjs/schedule` import from `purge()`
- `src/sync/sync.service.ts` — added `@Cron` daily job `purgeOldEvents()` delegating to `changeLogService.purge()`

## Checks

| Check | Result |
|-------|--------|
| `@Cron` removed from `ChangeLogService.purge()` | OK — decorator and import both removed cleanly |
| `purge()` still callable as plain method | OK — method signature and body unchanged |
| `SyncService.purgeOldEvents()` wired correctly | OK — delegates to `changeLogService.purge()`, schedule matches original (`EVERY_DAY_AT_MIDNIGHT`) |
| `ChangeLogService` injectable into `SyncService` | OK — `ChangelogModule` is `@Global()` and exports `ChangeLogService` |
| `ScheduleModule` available to `SyncModule` | OK — `ScheduleModule.forRoot()` registered in `AppModule` |
| `ChangelogModule` and `SyncModule` both in `AppModule.imports` | OK — lines 36-37 of `app.module.ts` |
| No orphaned imports in `changelog.service.ts` | OK — `Cron`, `CronExpression` removed; `Logger` still used by `purge()` logging |
| No migration needed | OK — no schema changes |
| Logging | OK — `purge()` logs its own result, cron wrapper stays silent (avoids duplicate log) |

## Minor observation

`SyncService.logger` (line 7) is declared but never referenced — `purgeOldEvents()` relies on `purge()` for logging. Not a bug; it follows the convention of other services and will likely be used as `SyncService` grows. No action needed.

## Verdict

Clean refactoring — scheduling moved to the correct domain module, no behavioral change, no missing wiring.

REVIEW_PASS
