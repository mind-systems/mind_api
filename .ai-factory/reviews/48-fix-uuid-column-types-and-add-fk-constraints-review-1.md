## Code Review Summary

**Files Reviewed:** 4 (3 entities + 1 migration)
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md** — WARN: no violations. Entities remain in their owning modules (`realtime/entities/`, `stats/entities/`). No cross-module repository access introduced. The migration-only FK strategy (no `@ManyToOne`) preserves ORM-level decoupling as documented.
- **RULES.md** — no violations. No non-null assertions, no sensitive data logging, no unnecessary logs added.
- **ROADMAP.md** — Phase 11 item "Fix UUID column types and add FK constraints" is checked off and aligns with this commit.

### Critical Issues

None.

### Suggestions

None.

### Positive Notes

- **Entity–migration alignment is exact.** Every `@Column({ type: 'uuid' })` decorator matches its corresponding SQL column type (`uuid NOT NULL` or `uuid DEFAULT NULL`).
- **FK cascade chain is now complete.** Every table with a `userId` referencing `users.id` has `ON DELETE CASCADE`: `user_sessions`, `breath_sessions`, `breath_session_settings`, `change_events`, `user_stats` (new), `personal_access_tokens` (new), `module_sessions` (new). The `session_stream_samples.moduleSessionId → module_sessions.id` FK completes the cascade: deleting a user propagates through `module_sessions` into `session_stream_samples`.
- **Down method drop order is correct with new FKs** — `session_stream_samples` dropped before `module_sessions`, and all user-referencing tables dropped before `users`.
- **Comma placement verified** — no trailing commas after the last constraint in any CREATE TABLE block.
- **No `activityRefId` FK** — correct decision. `breath_sessions` rows are independent and may outlive module sessions.
- **Clean, focused diff** — only the four planned column type fixes plus the bonus `personal_access_tokens` FK gap closure. No unrelated changes.

REVIEW_PASS
