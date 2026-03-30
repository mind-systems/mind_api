## Plan Review: Fix UUID column types and add FK constraints

**Tasks Reviewed:** 4
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md** — `WARN` (non-blocking). Plan modifies the InitialSchema migration in place rather than creating a new ALTER migration. This is correct: Phase 9 established a single flat migration with no production data, so in-place edits are the right approach. The "explicit migrations only, no synchronize" rule is satisfied. ORM-level decoupling (`no @ManyToOne`) is preserved while adding DB-level FK constraints — consistent with the Modular Monolith pattern.
- **RULES.md** — No violations. No non-null assertions, no logging changes, no sensitive data involved.
- **ROADMAP.md** — Plan maps directly to Phase 11 (`Fix UUID column types and add FK constraints`). The linked notes file (`04-phase-11-uuid-fix-details.md`) matches the plan exactly.

### Critical Issues

None.

### Suggestions

None.

### Positive Notes

- **Review #1 feedback incorporated.** The previous review flagged the missing `personal_access_tokens.userId` FK as a suggestion. This version of the plan includes it in Task 4, closing the last gap in user deletion cascading.
- **Line references are accurate.** Verified every line number against the current source files — all three entities and the InitialSchema migration match exactly.
- **Complete column coverage.** All four `character varying` → `uuid` fixes are accounted for: `module_sessions.userId` (line 261), `module_sessions.activityRefId` (line 263), `session_stream_samples.moduleSessionId` (line 285), `user_stats.userId` (line 210). No other varchar-storing-UUID columns exist in the migration.
- **Complete FK coverage.** After this plan, every table with a `userId` referencing `users.id` has `ON DELETE CASCADE`: `user_sessions` (existing), `breath_sessions` (existing), `breath_session_settings` (existing), `change_events` (existing), `user_stats` (added), `module_sessions` (added), `personal_access_tokens` (added). The `session_stream_samples.moduleSessionId → module_sessions.id` FK completes the cascade chain so user deletion propagates through `module_sessions` to their samples.
- **Correct omission of `activityRefId` FK.** The plan correctly skips adding a FK on `activityRefId → breath_sessions.id` — breath sessions are independently managed and outlive module sessions. Cascade-deleting module sessions should not destroy breath session references.
- **`down()` analysis is correct.** `DROP TABLE IF EXISTS` in reverse-dependency order already handles FK cleanup. `session_stream_samples` (FK to `module_sessions`) is dropped before `module_sessions`; all child tables referencing `users` are dropped before `users`. No `down()` changes needed.
- **Comment updates are precise.** The new entity comments ("No @ManyToOne — modules stay decoupled at the ORM level. FK constraint enforced in the InitialSchema migration.") accurately describe the post-change state: DB-level referential integrity without ORM-level relationship coupling.

PLAN_REVIEW_PASS
