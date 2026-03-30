## Plan Review — Fix `docs/realtime/database.md`

**Plan file:** `.ai-factory/plans/49-fix-docs-realtime-database-md.md`
**Files reviewed:** 8 (plan + target doc + 3 entities + enum + proto + migration)
**Risk Level:** 🟢 Low (docs-only change, no runtime impact)

### Context Gates

- **ARCHITECTURE.md:** WARN — no architectural concerns; this is a documentation fix within the realtime module's `docs/` directory. No boundary or dependency issues.
- **RULES.md:** WARN — rules cover code practices (non-null assertions, logging); not applicable to a docs-only plan.
- **ROADMAP.md:** OK — plan corresponds to the first bullet of Phase 12 ("Fix `docs/realtime/database.md`"). Scope matches exactly.

### Verification Summary

Every factual claim in the plan was cross-checked against the codebase:

| Claim | Source | Verdict |
|-------|--------|---------|
| Table renamed `live_sessions` → `module_sessions` | `ModuleSession` entity (`@Entity('module_sessions')`) | ✅ Correct |
| Broken intro backticks on line 3 | `database.md` line 3: `` ` ` `` | ✅ Confirmed |
| Proto service is `ModuleInstructionStreamService` | `proto/module_instruction_stream.proto` line 69 | ✅ Correct |
| Status enum missing `resumed` | `SessionStatus` enum has 6 values; doc lists 5 | ✅ Correct |
| `metadata` column exists (jsonb nullable) | Entity line 44, migration line 271 | ✅ Correct |
| Indices are single-column `userId` and `status` | Entity: `@Index(['userId'])`, `@Index(['status'])`; migration: two separate `CREATE INDEX` | ✅ Correct |
| `session_stream_samples` real columns: `id`, `moduleSessionId`, `samples`, `flushedAt`, `createdAt` | Entity: `session-stream-sample.entity.ts` | ✅ Exact match |
| FK is `moduleSessionId` with ON DELETE CASCADE | Migration line 293 | ✅ Correct |
| `StreamEngine` flushes buffer | Class exists: `src/realtime/services/stream-engine.service.ts` | ✅ Correct |
| `maxCompletedComplexity` missing from `user_stats` doc | Entity line 33, doc lines 43–51 | ✅ Confirmed |
| Position: between `longestStreak` and `lastSessionDate` | Entity column order | ✅ Correct |
| Type: `float default 0` | Entity: `@Column({ type: 'float', default: 0 })` | ✅ Correct |

### Issues

**1. `activityType` column type is wrong in the doc — plan doesn't fix it**
`docs/realtime/database.md` line 13 says `activityType | varchar`. The actual column is a PostgreSQL enum (`"public"."activity_type_enum"`) as confirmed in:
- Entity: `@Column({ type: 'enum', enum: ActivityType })`
- Migration: `"activityType" "public"."activity_type_enum" NOT NULL`
- Enum: `ActivityType { BREATH = 'breath' }`

Since Task 1 is already editing the `module_sessions` section (adding `metadata`, fixing `status` list, fixing indices), it should also fix `activityType` from `varchar` to `enum` with the current value `breath`. This is a factual inaccuracy that will remain in the doc otherwise.

**Fix:** Add to Task 1: change `activityType | varchar | Тип активности, например \`breath\`.` → `activityType | enum | Тип активности. Значения: \`breath\`.`

### Positive Notes

- All three tasks are well-scoped and correctly ordered (module_sessions → session_stream_samples → user_stats follows the doc's section order).
- The plan correctly identifies every stale reference (`live_sessions`, `liveSessionId`, `ModuleInstructionService`, composite indices) and maps each to the verified codebase state.
- Column descriptions for `session_stream_samples` rewrite are accurate — the plan correctly distinguishes the batch model (one row = one flush with a `samples` jsonb array) from the old per-instruction model.
- Language instruction (keep Russian) matches the project convention and neighboring docs.
- "Settings: no testing, no logging, docs: yes" is appropriate — no code changes, no risk of runtime regression.
