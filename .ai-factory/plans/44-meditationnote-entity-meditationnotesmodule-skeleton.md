# Plan: MeditationNote entity + MeditationNotesModule skeleton

## Context
Introduce a compiling `MeditationNotesModule` feature module — `MeditationNote` entity plus empty service/controller stubs — wired into `AppModule`, following the existing `NfbCalibrationModule` pattern. No gRPC methods or business logic yet; this milestone delivers only the skeleton.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Entity & module skeleton

- [x] **Task 1: Create the `MeditationNote` entity**
  Files: `src/meditation-notes/entities/meditation-note.entity.ts`
  Define `@Entity('meditation_notes')` mirroring the spec in `.ai-factory/notes/26-meditation-notes-entity-module.md`. Columns (snake_case DB names, camelCase properties), following the column-style conventions of `src/nfb-calibration/entities/nfb-calibration-record.entity.ts`:
  - `id` — `@PrimaryGeneratedColumn('uuid')`
  - `userId` — `@Column('uuid', { name: 'user_id' })`
  - `sessionId` — `@Column('uuid', { name: 'session_id', nullable: true })`, typed `string | null`
  - `poseName` — `@Column({ name: 'pose_name' })` (plain varchar)
  - `noteText` — `@Column({ name: 'note_text', type: 'text' })`
  - `createdAt` — `@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })`
  - `updatedAt` — `@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })`
  Do not use the non-null assertion operator anywhere (project rule).

- [x] **Task 2: Create the `MeditationNotesService` stub** (depends on Task 1)
  Files: `src/meditation-notes/meditation-notes.service.ts`
  `@Injectable()` service that injects the entity repository confined to this module — `@InjectRepository(MeditationNote) private readonly repo: Repository<MeditationNote>` (mirrors `src/nfb-calibration/nfb-calibration.service.ts`). No methods required at this stage; the repository injection establishes the data-access boundary and keeps the module compiling.

- [x] **Task 3: Create the `MeditationNotesGrpcController` stub** (depends on Task 2)
  Files: `src/meditation-notes/meditation-notes.grpc.controller.ts`
  `@Controller()` with `@UseFilters(GrpcExceptionFilter)` and `@UseInterceptors(GrpcAuthInterceptor)` (same decorators as `NfbCalibrationGrpcController`), constructor-injecting `MeditationNotesService`. No `@GrpcMethod` handlers yet — no meditation-notes proto contract exists. Keep imports minimal so the file compiles cleanly.

### Phase 2: Wiring

- [x] **Task 4: Create `MeditationNotesModule`** (depends on Tasks 1-3)
  Files: `src/meditation-notes/meditation-notes.module.ts`
  `@Module` with `imports: [AuthModule, TypeOrmModule.forFeature([MeditationNote])]`, `controllers: [MeditationNotesGrpcController]`, `providers: [MeditationNotesService]`. No `exports` array — no other module consumes this service (modular-monolith boundary). Mirrors `src/nfb-calibration/nfb-calibration.module.ts`.

- [x] **Task 5: Register `MeditationNotesModule` in `AppModule`** (depends on Task 4)
  Files: `src/app.module.ts`
  Add the import statement next to the `NfbCalibrationModule` import, and add `MeditationNotesModule` to the `imports` array immediately after `NfbCalibrationModule`. Verify the project compiles with `npm run build`.

## Commit Plan
- **Commit 1** (after tasks 1-5): "Add MeditationNotesModule skeleton with MeditationNote entity"
