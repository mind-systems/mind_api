# Review: Change Events TTL

## Code Review Summary

**Files Reviewed:** 2
**Risk Level:** 🟢 Low

### Context Gates

| Gate | Status |
|------|--------|
| ARCHITECTURE.md | WARN — `ChangelogModule` is `@Global()` and exports `ChangeLogService`, so `SyncService` can inject it without an explicit import in `SyncModule`. `ScheduleModule.forRoot()` is registered in `AppModule` — `@Cron` decorators work in any module. No boundary violations. |
| RULES.md | OK — no non-null assertions, no sensitive data logged, logging is lean (`purge()` logs its own outcome, wrapper stays silent). |
| ROADMAP.md | OK — milestone "Change Events TTL" is marked `[x]`, description matches implementation. |

### Critical Issues

None.

### Suggestions

None.

### Positive Notes

- Clean, minimal refactoring — only the scheduling responsibility moved, no behavioral change to `purge()` itself.
- Correct decision to let `purge()` handle its own logging rather than adding a log in `purgeOldEvents()` — avoids duplication and follows the "keep logs lean" rule.
- `SyncService.logger` is declared but unused — consistent with the convention in other services and will be useful as `SyncService` grows. No action needed.

REVIEW_PASS
