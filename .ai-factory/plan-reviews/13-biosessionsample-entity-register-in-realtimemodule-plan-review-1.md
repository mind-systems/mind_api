# Plan Review: BioSessionSample entity + register in RealtimeModule

**Plan:** `13-biosessionsample-entity-register-in-realtimemodule.md`
**Reviewed:** 2026-05-28

## Verification Against Codebase

### Migration alignment (`src/migrations/1779990145496-AddBioSessionSamplesTable.ts`)
- Table name `bio_session_samples` ✓
- Columns: `id` uuid PK, `moduleSessionId` uuid, `samples` jsonb, `flushedAt` timestamp, `createdAt` timestamp default `now()` ✓
- Quoted **camelCase** columns — plan correctly notes no `name:` mapping needed ✓
- Index `IDX_bio_session_samples_moduleSessionId` on `("moduleSessionId")` matches `@Index(['moduleSessionId'])` on the class ✓

### Mirror of `SessionStreamSample` (`src/realtime/entities/session-stream-sample.entity.ts`)
The reference entity (lines 1–27) uses exactly the imports and decorators the plan prescribes (`Column`, `CreateDateColumn`, `Entity`, `Index`, `PrimaryGeneratedColumn`). The plan's task instructions reproduce that file 1:1 with only the table name changed — correct.

### Module registration (`src/realtime/realtime.module.ts`)
- Current `TypeOrmModule.forFeature([ModuleSession, SessionStreamSample])` (line 22) — the plan extends this exactly as required ✓
- The plan correctly forbids adding the repository to `exports` of `RealtimeModule`, in line with `ARCHITECTURE.md` line 94 ("Entities stay in their module") and line 191 ("Cross-module repository access" anti-pattern) ✓

### Note 03 §3 conformance
Verified against `.ai-factory/notes/03-biometric-stream-service.md` lines 78–94:
- camelCase columns, no `name:` mapping ✓
- `samples` shape `{timestamp, sampleType, data}` ✓
- Index name and FK convention already handled by the migration; entity's `@Index(['moduleSessionId'])` does not collide because the migration already created `IDX_bio_session_samples_moduleSessionId` and TypeORM will not re-create it (no `synchronize`, see `mind_api/CLAUDE.md` → "synchronize is always false")

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** PASS. Plan respects entity ownership (`@InjectRepository` confined to `RealtimeModule`, no cross-module exports of the new repository).
- **Rules (`RULES.md`):** PASS. No migration is being authored here (already exists at task 12); no roadmap rule violation.
- **Roadmap (`ROADMAP.md`):** PASS. Task is sequenced after the existing `AddBioSessionSamplesTable` migration (task 12) and before the engine/controller consumers (notes 05, 06). Plan explicitly defers controller/provider wiring to later roadmap tasks.

## Critical Issues

None.

## Minor Observations

- The plan does not call out the `@Index(['moduleSessionId'])` decorator producing a second TypeORM-managed index name in metadata. With `synchronize: false` and `migrationsRun: true`, this is purely a no-op at runtime — the migration's `IDX_bio_session_samples_moduleSessionId` already exists. Consistent with how `session-stream-sample.entity.ts` handles the same situation, so no change required.
- The plan does not include a build step. With only an entity file added and a one-line module change, a `npm run build` after both tasks is implicit; explicit mention would be nice-to-have but not required given the "Testing: no / Logging: minimal / Docs: no" settings.

## Positive Notes

- The plan correctly anchors decisions to specific sources (note 03 §3, `CLAUDE.md`, `ARCHITECTURE.md`) and the reference entity file path.
- Boundaries are tight: the plan explicitly refuses to export the repository or wire any consumer, deferring that to future tasks. This keeps blast radius minimal and matches the orchestrator's incremental task layout.
- Naming and column conventions verified against the actual migration — no drift between the SQL DDL and the proposed TypeORM column definitions.

PLAN_REVIEW_PASS
