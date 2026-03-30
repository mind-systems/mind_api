## Plan Review: Fix UUID column types and add FK constraints

**Tasks Reviewed:** 4
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md** — `WARN` Plan modifies the InitialSchema migration in place. This is correct: Phase 9 established a single flat migration with no production data, so in-place edits are the right approach. Architecture says "explicit migrations only, no synchronize" — satisfied. The plan intentionally avoids `@ManyToOne` to keep modules decoupled at the ORM level, consistent with the Modular Monolith pattern.
- **RULES.md** — No violations. No non-null assertions, no logging changes, no sensitive data involved.
- **ROADMAP.md** — Plan maps directly to Phase 11 (`Fix UUID column types and add FK constraints`). Roadmap links to the detailed notes file, which matches the plan exactly.

### Critical Issues

None.

### Suggestions

1. **`personal_access_tokens.userId` is missing the same FK constraint.**
   The migration (line 244) already has `"userId" uuid NOT NULL` (correct type), but there is no `FOREIGN KEY` referencing `users(id)`. Every other table with a `userId` column that references `users` has `ON DELETE CASCADE`:
   - `user_sessions` (line 99–100) ✅
   - `breath_sessions` (line 149–150) ✅
   - `breath_session_settings` (line 196–197) ✅
   - `change_events` (line 232–233) ✅
   - `user_stats` — being added by this plan ✅
   - `module_sessions` — being added by this plan ✅
   - **`personal_access_tokens` — still missing** ❌

   Deleting a user will leave orphaned PAT rows. Since this plan already touches FK constraints in the same migration file, adding one line for `personal_access_tokens` is near-zero effort and closes the last gap in user deletion cascading.

   ```sql
   CONSTRAINT "FK_personal_access_tokens_userId"
     FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
   ```

### Positive Notes

- **Line references are accurate.** Every line number cited in the plan matches the current source files — verified against all three entity files and the migration.
- **Scope is well-defined.** The plan correctly identifies all four `character varying` columns that should be `uuid`, doesn't over-reach, and explains the intentional omission of a FK on `activityRefId`.
- **Cascade chain is correct.** `users → module_sessions → session_stream_samples` propagation is properly designed; `down()` already drops tables in reverse FK-dependency order so no changes needed there.
- **Comment updates are accurate.** The new entity comments ("No @ManyToOne — modules stay decoupled at the ORM level. FK constraint enforced in the InitialSchema migration.") precisely describe the post-change state — DB-level FK without ORM-level relationship.
- **Notes file is thorough.** The linked `04-phase-11-uuid-fix-details.md` provides exact before/after SQL and a commit plan, making implementation straightforward.
