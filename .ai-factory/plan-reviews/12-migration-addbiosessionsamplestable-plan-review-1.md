# Plan Review: Migration `AddBioSessionSamplesTable`

**Plan:** `.ai-factory/plans/12-migration-addbiosessionsamplestable.md`
**Files Reviewed:** 1 plan + reference migration + entity + roadmap
**Risk Level:** 🟢 Low

## Context Gates

- **ARCHITECTURE / RULES:** No applicable rules. RULES.md covers non-null assertions, sensitive logging, and gRPC `@Payload()` decorator usage — none apply to a pure DDL migration. ✅
- **ROADMAP alignment:** Plan implements `mind_api/.ai-factory/ROADMAP.md` line 45 (Phase 19 — Migration `AddBioSessionSamplesTable`). Spec in the roadmap matches the plan exactly: quoted camelCase columns, PK/FK/index names, CASCADE on FK, mirror of `session_stream_samples`. ✅ WARN-free.
- **Project convention (CLAUDE.md):** Plan uses `npx typeorm migration:create` per the "Never hand-craft migration timestamps" rule. Action-based name (`AddBioSessionSamplesTable`) matches the convention examples. ✅

## Verification of References

- `src/migrations/1774863293946-InitialSchema.ts:285-298` — confirmed to define `session_stream_samples` with the exact column set, types, PK/FK names, and CASCADE behavior described in the plan. Mirror specification in Task 2 is byte-accurate to the reference.
- `src/migrations/1774863293946-InitialSchema.ts:305-308` — confirmed to use the `DROP INDEX IF EXISTS` → `DROP TABLE IF EXISTS` order. Task 3 mirrors this faithfully.
- `uuid_generate_v4()` — available because `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` runs in `InitialSchema.up` (line 10). New migration does not need to re-create the extension. ✅
- `src/realtime/entities/session-stream-sample.entity.ts` — uses bare camelCase fields with no `name:` mapping (`@Column({ type: 'uuid' }) moduleSessionId: string`). Plan's rationale for quoted camelCase column identifiers (so milestone-13 entity can mirror this style) is correct. ✅

## Findings

### Critical Issues
None.

### Medium / Minor

1. **`DROP INDEX` is redundant but consistent with project style.** PostgreSQL drops a table's indexes automatically with `DROP TABLE`, so the explicit `DROP INDEX IF EXISTS` in `down()` is a no-op by the time the index is gone. The plan mirrors `InitialSchema.down` for consistency, which is the right call — flagging only for awareness, no action needed.

2. **Task 4 mentions `npm run build` conditionally** ("If `npm run build` is part of the project's quality gate"). Per `mind_api/CLAUDE.md` the project does have `npm run build`. Since the migration file is plain TypeScript with no imports beyond `typeorm`, compilation should pass trivially, but running `npm run build` once is cheap and worth doing unconditionally. Suggest dropping the conditional.

3. **Class-name convention.** `typeorm migration:create` generates `class <Name><Timestamp>` (e.g. `AddBciDevicesTable1779369537954`). The plan describes this correctly as `AddBioSessionSamplesTable<timestamp>`. Just confirming the orchestrator should leave the auto-generated class name and `name = '...'` property intact — both must match the filename's timestamp suffix for TypeORM's migration tracking. Worth being explicit in Task 1 that the auto-generated class name and `name` field must not be edited.

### Positive Notes

- Plan correctly enforces CLI-generated timestamps, satisfying the project's recurring migration-feedback rule (`feedback_migrations.md` in user memory).
- Task ordering (scaffold → up → down → verify) with explicit dependencies is sound.
- Task 4 includes both `migration:run` and `migration:revert` round-trip, then re-applies — exactly the verification depth a schema-only change needs.
- Plan explicitly forbids adding `name:` column mapping and explains why (lets the future entity use bare camelCase properties), preventing a foot-gun for milestone 13.
- Mirror approach to `session_stream_samples` (identical column set, constraint naming pattern, index naming pattern) means the future time-join query at `(moduleSessionId, timestamp)` will operate on symmetric schemas — good architectural consistency.

PLAN_REVIEW_PASS
