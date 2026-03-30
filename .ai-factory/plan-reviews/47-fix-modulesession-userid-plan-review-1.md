## Plan Review: Fix `ModuleSession.userId`

**Plan file:** `.ai-factory/plans/47-fix-modulesession-userid.md`
**Files referenced:** 1
**Risk Level:** 🔴 High — the plan contains a factually wrong assumption that, if followed, creates a schema mismatch

### Context Gates

- **ARCHITECTURE.md:** WARN — no conflict; the change is within the `realtime` module boundary
- **RULES.md:** WARN — no conflict; no sensitive data or non-null assertions involved
- **ROADMAP.md:** ERROR — the plan covers only 1 of 7 tasks in Phase 11; see Critical Issues below

### Critical Issues

1. **Wrong assumption: "the DB column is already `uuid`"**

   The plan states:
   > No migration is needed — the DB column is already `uuid` from the original migration; this change only corrects the TypeORM metadata.

   This is **false**. The `InitialSchema` migration (`src/migrations/1774863293946-InitialSchema.ts`, line 261) creates the column as:

   ```sql
   "userId" character varying NOT NULL
   ```

   The column is `character varying`, not `uuid`. Changing the entity decorator to `@Column({ type: 'uuid' })` without fixing the migration creates a mismatch: TypeORM metadata says `uuid`, but the DB schema (on any fresh setup) creates `character varying`. Since `migrationsRun: true` on startup and there is no production data (Phase 9 context), the InitialSchema migration IS the source of truth for the DB schema.

   **Impact:** on a fresh database, TypeORM may generate queries with `::uuid` casts against a `varchar` column, causing runtime errors or silent type coercion bugs.

2. **Plan scope is a fragment of Roadmap Phase 11**

   The Roadmap Phase 11 defines 7 tasks across 3 sub-phases (11.1, 11.2, 11.3) that are designed to be executed together:

   - **11.1** — fix 4 entity decorators (`ModuleSession.userId`, `ModuleSession.activityRefId`, `SessionStreamSample.moduleSessionId`, `UserStats.userId`)
   - **11.2** — update stale comments in 2 entity files
   - **11.3** — fix the `InitialSchema` migration (change `character varying` → `uuid`, add FK constraints, verify `down()`)

   This plan covers only 11.1 Task 1 (one entity field). Executing it in isolation — without 11.3 (migration fix) — leaves the entity and DB out of sync. The Roadmap explicitly states: "All four must be fixed together — entities and migration in sync."

### Suggestions

1. **Expand the plan to cover all of Phase 11, or at minimum 11.1 + 11.3 together.** The entity decorator change is meaningless without the corresponding migration fix. Doing one without the other is worse than doing neither — it creates a false sense of correctness while introducing a real mismatch.

2. **If the plan intentionally only covers the decorator** (with 11.3 coming in a separate plan), the context section must say so explicitly: "The migration will be fixed in a separate plan (Phase 11.3). Until then, the DB column remains `character varying` — this is a known intermediate inconsistency." The current wording ("no migration is needed") is misleading and would confuse the implementing agent.

### Positive Notes

- Correct file path and line number for the entity field
- Correct target decorator syntax (`{ type: 'uuid' }`)
