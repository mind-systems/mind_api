# Code Review: BioSessionSample entity + register in RealtimeModule

**Plan:** `13-biosessionsample-entity-register-in-realtimemodule.md`
**Reviewed:** 2026-05-28
**Scope:** new `src/realtime/entities/bio-session-sample.entity.ts`, modified `src/realtime/realtime.module.ts`

## Verification

### Entity vs. migration (`src/migrations/1779990145496-AddBioSessionSamplesTable.ts`)

| DDL column | Entity field | Match |
|---|---|---|
| `"id" uuid PK DEFAULT uuid_generate_v4()` | `@PrimaryGeneratedColumn('uuid') id: string` | ✓ |
| `"moduleSessionId" uuid NOT NULL` | `@Column({ type: 'uuid' }) moduleSessionId: string` | ✓ |
| `"samples" jsonb NOT NULL` | `@Column({ type: 'jsonb' }) samples: Record<string, unknown>[]` | ✓ |
| `"flushedAt" TIMESTAMP NOT NULL` | `@Column() flushedAt: Date` | ✓ (TypeORM infers `timestamp` from `Date` reflect metadata — same pattern as `SessionStreamSample`) |
| `"createdAt" TIMESTAMP NOT NULL DEFAULT now()` | `@CreateDateColumn() createdAt: Date` | ✓ |
| `IDX_bio_session_samples_moduleSessionId` on `("moduleSessionId")` | `@Index(['moduleSessionId'])` on class | ✓ (column name & camelCase casing aligned; `synchronize: false` so no DDL regeneration risk) |
| `FK_bio_session_samples_moduleSessionId` → `module_sessions(id)` CASCADE | Not represented as `@ManyToOne` — entity stays detached, mirroring `SessionStreamSample` | ✓ (consistent with reference entity) |

Column names are quoted camelCase in the SQL DDL, so TypeORM's default naming (property name = column name) matches without any `name:` mapping. This is correct per note 03 §3.

### Entity vs. reference (`src/realtime/entities/session-stream-sample.entity.ts`)
Diff is structural: identical import list, identical decorator set, identical column shapes; only `@Entity` table name and class name differ. Mirror is exact, as the plan required.

### Module registration (`src/realtime/realtime.module.ts`)
- Import added at line 13 (`BioSessionSample`) alongside the existing `SessionStreamSample` import.
- Entity appended to `TypeOrmModule.forFeature([ModuleSession, SessionStreamSample, BioSessionSample])` at line 23.
- Not added to `exports` — `@InjectRepository(BioSessionSample)` is correctly confined to `RealtimeModule`, matching `ARCHITECTURE.md` §"Entities stay in their module" and the modular-monolith rule in `CLAUDE.md`.
- No controller/provider wiring touched — consumers land in the later roadmap tasks (notes 05, 06).

## Runtime considerations

- **Migration sequencing:** `AddBioSessionSamplesTable1779990145496` is already on disk (Phase 19 task 2). With `migrationsRun: true` (per `database.config.ts`), the table is created on the next process start — the new entity will resolve its repository against an existing table.
- **`synchronize: false`** in `database.config.ts` ensures the `@Index(['moduleSessionId'])` metadata cannot conflict with the SQL-created `IDX_bio_session_samples_moduleSessionId` — TypeORM will not attempt to create a duplicate.
- **No new provider consumes the repository yet** — adding it to `forFeature` registers the repository token in the DI container but does not inject it anywhere; safe no-op until the engine lands.
- **TypeScript compilation:** entity types are scalar primitives + `Date` + `Record<string, unknown>[]`; no `tsconfig`-sensitive constructs (no decorators that need `strictPropertyInitialization` workarounds beyond the existing project conventions used in `SessionStreamSample`).

## Findings

None.

REVIEW_PASS
