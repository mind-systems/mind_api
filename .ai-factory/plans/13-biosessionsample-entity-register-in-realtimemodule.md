# Plan: BioSessionSample entity + register in RealtimeModule

## Context
Create the `BioSessionSample` TypeORM entity that maps to the `bio_session_samples` table introduced by the `AddBioSessionSamplesTable` migration, and register it with `RealtimeModule` so its repository is injectable inside the realtime layer. The entity is a direct mirror of `SessionStreamSample` (camelCase columns, no `name:` mapping) per note 03 §3.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Entity + module registration

- [x] **Task 1: Create `BioSessionSample` entity**
  Files: `src/realtime/entities/bio-session-sample.entity.ts`
  Create the entity as a direct mirror of `src/realtime/entities/session-stream-sample.entity.ts`:
  - `@Entity('bio_session_samples')`
  - `@Index(['moduleSessionId'])` on the class
  - `@PrimaryGeneratedColumn('uuid') id: string`
  - `@Column({ type: 'uuid' }) moduleSessionId: string`
  - `@Column({ type: 'jsonb' }) samples: Record<string, unknown>[]` — array elements have shape `{timestamp, sampleType, data}` per note 03 §3
  - `@Column() flushedAt: Date`
  - `@CreateDateColumn() createdAt: Date`
  Use the same imports as `session-stream-sample.entity.ts` (`Column`, `CreateDateColumn`, `Entity`, `Index`, `PrimaryGeneratedColumn` from `typeorm`). Do **not** use `name:` mapping on any column — the migration uses quoted camelCase column names, so the TypeORM defaults already match.

- [x] **Task 2: Register `BioSessionSample` in `RealtimeModule`** (depends on Task 1)
  Files: `src/realtime/realtime.module.ts`
  Import `BioSessionSample` from `./entities/bio-session-sample.entity` alongside the existing `SessionStreamSample` import, and add it to the `TypeOrmModule.forFeature([...])` array in `imports`:
  ```ts
  TypeOrmModule.forFeature([ModuleSession, SessionStreamSample, BioSessionSample]),
  ```
  Do not export the repository or the entity — `@InjectRepository(BioSessionSample)` must remain confined to consumers inside `RealtimeModule` per the modular-monolith rule (`CLAUDE.md`, `ARCHITECTURE.md`). No other module gets access. No controller/provider changes in this task — the engine and controller that consume the repository land in later roadmap tasks.

<!-- orchestrator-sessions
planner: d09fb446-00ba-4c98-8835-767ee142f6b0
elapsed: 274
implementer: 1041c4ae-b992-46a5-8aa9-6b90d30f1ba2
-->
