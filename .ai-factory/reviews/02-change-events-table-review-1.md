## Code Review Summary

**Files Reviewed:** 5
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** WARN — none. `ChangelogModule` follows the `@Global()` cross-cutting module pattern (same as `MailModule`). Entity stays inside its owning module. Service uses `@InjectRepository` within its own module only. No boundary violations.
- **RULES.md:** WARN — none. No non-null assertions (`!`). No sensitive data in logs (purge logs affected row count only). Logs are lean — single log line on purge, nothing else.
- **ROADMAP.md:** WARN — none. Milestone "Change Events Table" is present and marked complete. All four planned deliverables (entity, migration, service, module) are implemented.

### Critical Issues

None.

### Suggestions

None.

### Positive Notes

- **Migration follows existing patterns exactly.** Raw SQL style, `name` property, index as a separate statement — matches the `CreatePersonalAccessTokensTable` migration.
- **Parameterized batch insert in `logForRecipients`.** Correct positional parameter indexing (`$1..$4N`), early return for empty array, single INSERT with multiple value tuples. Efficient and injection-safe.
- **Cursor-based pagination done right.** The `limit+1` fetch pattern in `getChanges` avoids a separate COUNT query. Edge case of empty results handled correctly — cursor falls back to `afterId`.
- **`getMinEventId` handles empty table.** Returns `null` when no rows exist, with correct `parseInt` for the raw SQL string result.
- **`purge` uses `make_interval(days => :days)`** with a TypeORM parameter — safe and readable.
- **Composite index `(userId, id)`** covers the main query pattern `WHERE userId = ? AND id > ? ORDER BY id`.

REVIEW_PASS
