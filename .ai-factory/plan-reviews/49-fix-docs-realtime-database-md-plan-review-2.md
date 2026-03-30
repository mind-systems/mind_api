## Plan Review Summary

**Plan:** Fix `docs/realtime/database.md`
**Files Affected:** 1 (`docs/realtime/database.md`)
**Risk Level:** 🟢 Low (documentation-only change, no code or migrations)

### Context Gates

- **ARCHITECTURE.md** — PASS. No architectural impact; doc fix only.
- **RULES.md** — PASS. No code changes; rules about `!` operator, sensitive logging, and lean logs are not applicable.
- **ROADMAP.md** — PASS. Plan maps directly to the first bullet of Phase 12 ("Fix `docs/realtime/database.md`").

### Verification Against Codebase

All claims in the plan were verified against source files:

| Plan claim | Source of truth | Verified |
|---|---|---|
| Table renamed to `module_sessions` | `module-session.entity.ts` line 11: `@Entity('module_sessions')` | ✅ |
| Intro has empty backticks | `database.md` line 3: `` ` ` `` | ✅ |
| `ModuleInstructionService` is stale | `proto/module_instruction_stream.proto` line 69: `service ModuleInstructionStreamService` | ✅ |
| `resumed` status missing from doc | `session-status.enum.ts` line 7: `RESUMED = 'resumed'` | ✅ |
| `metadata` column missing from doc | `module-session.entity.ts` line 44: `@Column({ type: 'jsonb', nullable: true })` | ✅ |
| Indices are single-column, not composite | `module-session.entity.ts` lines 12–13: `@Index(['userId'])`, `@Index(['status'])` | ✅ |
| `session_stream_samples` columns are wrong | `session-stream-sample.entity.ts`: real columns are `moduleSessionId`, `samples`, `flushedAt`, `createdAt` | ✅ |
| Rows are batches, not individual samples | `stream-engine.service.ts` line 126–131: `sampleRepo.save({ moduleSessionId, samples, flushedAt })` | ✅ |

### Issues

**1. Missing step: `user_stats` section omits `maxCompletedComplexity` column**

The `user_stats` entity (`src/stats/entities/user-stats.entity.ts` line 33) and the `InitialSchema` migration both define a `maxCompletedComplexity` column (`float`, default `0`). The doc's `user_stats` table (lines 40–53) does not list it.

Since the plan's scope is "fix `database.md` to match the actual schema," this column should be added in the same pass. It's the same file and same type of fix — documenting what actually exists.

Suggested addition to Task 1 or as a new Task 3:

> Add `maxCompletedComplexity` to the `user_stats` schema table: `maxCompletedComplexity` — float default 0 — maximum complexity among completed qualifying sessions.

**2. Intro sentence for `session_stream_samples` will become slightly misleading**

Line 3 currently says `session_stream_samples` "хранит инструкции, переданные через `ModuleInstructionService`". Task 1 fixes the service name to `ModuleInstructionStreamService`, but Task 2 rewrites the section to describe batch storage. After both tasks, the intro will say the table "stores instructions" while the section body says "each row is a batch." Consider updating the intro to say something like "хранит батчи сэмплов" to stay consistent with the rewritten section.
