## Plan Review: Fix `docs/realtime/database.md`

**Plan file:** `.ai-factory/plans/50-fix-docs-realtime-database-md.md`
**Files reviewed:** 8 (plan, target doc, 3 entities, 2 enums, migration)
**Risk Level:** 🟢 Low (documentation-only change)

### Context Gates

- **ARCHITECTURE.md:** `WARN` — No architectural concerns; this is a docs-only plan.
- **RULES.md:** `WARN` — No code changes; rules about non-null assertions and logging are not applicable.
- **ROADMAP.md:** OK — Plan corresponds to the first item in Phase 12 ("Fix `docs/realtime/database.md`").

### Verification Summary

Every claim in the plan was checked against the actual codebase:

| Plan claim | Source of truth | Verdict |
|---|---|---|
| Table renamed to `module_sessions` | `@Entity('module_sessions')` in entity | ✅ Correct |
| `activityType` is `enum`, not `varchar` | `@Column({ type: 'enum', enum: ActivityType })` | ✅ Correct |
| `ActivityType` has value `breath` | `ActivityType.BREATH = 'breath'` in enum | ✅ Correct |
| `status` enum includes `resumed` | `SessionStatus` enum has 6 values including `RESUMED` | ✅ Correct |
| `metadata` column exists (`jsonb nullable`) | `@Column({ type: 'jsonb', nullable: true })` in entity | ✅ Correct |
| Indices are single-column `(userId)` and `(status)` | `@Index(['userId'])` + `@Index(['status'])` on entity class | ✅ Correct |
| `session_stream_samples` stores batches, not per-sample rows | Entity has `samples: Record<string, unknown>[]` (jsonb) | ✅ Correct |
| `moduleSessionId` FK with `ON DELETE CASCADE` | Migration: `FOREIGN KEY ("moduleSessionId") REFERENCES "module_sessions"("id") ON DELETE CASCADE` | ✅ Correct |
| `flushedAt` type is `timestamptz` | Migration: `"flushedAt" TIMESTAMP NOT NULL` | ❌ Wrong |
| `maxCompletedComplexity` exists between `longestStreak` and `lastSessionDate` | Entity field order matches | ✅ Correct |
| Service name is `ModuleInstructionStreamService` | Proto rename in Phase 7 (roadmap 7.1) | ✅ Correct |

### Issues

**1. Task 3: `flushedAt` type is `TIMESTAMP`, not `timestamptz`**
File: plan Task 3, column table
The plan says to document `flushedAt` as `timestamptz`. The actual migration defines it as `TIMESTAMP NOT NULL` (without timezone), and the entity uses a bare `@Column()` with no explicit type — which TypeORM maps to `TIMESTAMP`. Documenting it as `timestamptz` would be inaccurate.

For reference, the only column in the realtime tables that is actually `TIMESTAMP WITH TIME ZONE` is `module_sessions.disconnectedAt` (entity has `type: 'timestamptz'` explicitly; migration has `TIMESTAMP WITH TIME ZONE`).

Fix: change `flushedAt — timestamptz` to `flushedAt — timestamp` in Task 3.

**2. Task 2: Existing timestamp type inaccuracies not addressed**
File: plan Task 2, scope of rewrite
The current doc labels `startedAt`, `endedAt`, `lastActivityAt`, and `createdAt` as `timestamptz`. In reality, only `disconnectedAt` is `TIMESTAMP WITH TIME ZONE` — all others are plain `TIMESTAMP` per the migration. Since Task 2 is described as a "rewrite" of the section, these pre-existing type errors should be fixed at the same time; otherwise the rewritten doc carries over stale inaccuracies from the version it's replacing.

Fix: add a bullet to Task 2 specifying the correct types — `timestamp` for `startedAt`, `endedAt`, `lastActivityAt`, `createdAt`; `timestamptz` only for `disconnectedAt`.

### Positive Notes

- The plan correctly identifies every structural change between the current doc and the actual entity/migration state (renamed table, changed column type, missing enum value, missing column, wrong indices, completely wrong `session_stream_samples` schema).
- Documentation language is Russian throughout, matching the existing docs and project convention.
- Tasks are ordered logically (intro → module_sessions → session_stream_samples → user_stats) and map cleanly to the doc's section structure.
- The `ON DELETE CASCADE` detail for `moduleSessionId` FK is a nice addition that the original doc was missing.
