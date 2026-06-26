# Plan: Rename proto + API backend to ModuleSessionNote

## Context
Generalize the meditation-notes feature into a module-agnostic "module session note" by renaming the proto contract, NestJS module, entity, table, and mappers, and dropping the redundant `pose_id` field that duplicates `module_sessions.activityRefId`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Assumptions
- Wire compatibility: per the milestone, `note_text` keeps its existing field number (4 in the message, 3 in `CreateNoteRequest`). Dropped `pose_id` field numbers become `reserved` so they are never reused. The note's open question ("verify field numbering with mobile team before deploying") is treated as resolved in favor of *not renumbering* `note_text`.
- This milestone is API-backend-only. Copying the renamed proto into `mind_mcp` / `mind_mobile` and regenerating their stubs is out of scope (handled by those consumers separately, per proto-ownership rules).
- The proto package stays `mind` (unchanged); only the file, service, and message names change.

## Tasks

### Phase 1: Proto contract

- [x] **Task 1: Rename and edit the proto file**
  Files: `proto/module_session_notes.proto` (new), `proto/meditation_notes.proto` (delete)
  Create `proto/module_session_notes.proto` by copying `proto/meditation_notes.proto`, then apply:
  - Rename message `MeditationNote` → `ModuleSessionNote`. Remove `string pose_id = 3;` and add `reserved 3;` (and `reserved "pose_id";`) in its place. Keep `note_text = 4`, `created_at = 5`, `updated_at = 6` at their existing numbers. Keep `id = 1`, `session_id = 2`.
  - In `CreateNoteRequest`: remove `string pose_id = 2;` and add `reserved 2;` (and `reserved "pose_id";`). Keep `session_id = 1` and `note_text = 3` at their existing numbers (do NOT renumber `note_text`).
  - `UpdateNoteRequest` and `ListNotesRequest`: no structural change.
  - `ListNotesResponse`: change `repeated MeditationNote notes = 1;` → `repeated ModuleSessionNote notes = 1;`.
  - Rename `service MeditationNotesService` → `service ModuleSessionNotesService`; the three RPCs (`CreateNote`, `UpdateNote`, `ListNotes`) keep their names, but `CreateNote`/`UpdateNote` now return `ModuleSessionNote`.
  - Update the header comments that reference `MeditationNote` / `src/meditation-notes/` to point at `ModuleSessionNote` / `src/module-session-notes/`.
  Delete `proto/meditation_notes.proto`.

- [x] **Task 2: Regenerate gRPC stubs** (depends on Task 1)
  Files: `proto/generated/module_session_notes.ts` (new), `proto/generated/meditation_notes.ts` (delete)
  Delete `proto/generated/meditation_notes.ts`, then run `npm run proto:gen` (the `protoc … --ts_proto_out=./proto/generated … ./proto/*.proto` script). Confirm `proto/generated/module_session_notes.ts` is produced with `ModuleSessionNote`, `CreateNoteRequest` (no `poseId`), and `ModuleSessionNotesService` symbols.

### Phase 2: Persistence

- [x] **Task 3: Rename the entity**
  Files: `src/module-session-notes/entities/module-session-note.entity.ts` (new), `src/meditation-notes/entities/meditation-note.entity.ts` (delete)
  Move the entity into the new `src/module-session-notes/` directory. Rename class `MeditationNote` → `ModuleSessionNote`, change `@Entity('meditation_notes')` → `@Entity('module_session_notes')`, and remove the `@Column({ name: 'pose_id' }) poseId: string;` property. Keep all other columns unchanged.

- [x] **Task 4: Create the rename migration** (depends on Task 3)
  Files: `src/migrations/<timestamp>-RenameToModuleSessionNotes.ts` (new)
  Generate the file via CLI only: `npx typeorm migration:create src/migrations/RenameToModuleSessionNotes` (never hand-craft the timestamp). Fill `up()`:
  - `ALTER TABLE meditation_notes RENAME TO module_session_notes`
  - `ALTER TABLE module_session_notes DROP COLUMN pose_id`
  And `down()` (reverse order, data for `pose_id` cannot be recovered):
  - `ALTER TABLE module_session_notes ADD COLUMN pose_id varchar NOT NULL DEFAULT ''`
  - `ALTER TABLE module_session_notes RENAME TO meditation_notes`
  Use `queryRunner.query(...)` for each statement.

### Phase 3: Application layer

- [x] **Task 5: Rename the service** (depends on Task 3)
  Files: `src/module-session-notes/module-session-notes.service.ts` (new), `src/meditation-notes/meditation-notes.service.ts` (delete)
  Move and rename class `MeditationNotesService` → `ModuleSessionNotesService`. Import the renamed `ModuleSessionNote` entity. Remove the `poseId` parameter from `create()` and drop it from the `repo.create({ ... })` call (keep `userId`, `sessionId`, `noteText`). Leave the `QueryFailedError` handling (`23505` already-exists, `23503` detach-session) and `updateText`/`list` methods unchanged.

- [x] **Task 6: Rename the gRPC controller** (depends on Tasks 2, 5)
  Files: `src/module-session-notes/module-session-notes.grpc.controller.ts` (new), `src/meditation-notes/meditation-notes.grpc.controller.ts` (delete)
  Move and rename class `MeditationNotesGrpcController` → `ModuleSessionNotesGrpcController`. Update imports to `../../proto/generated/module_session_notes` and alias `ModuleSessionNote as ModuleSessionNoteProto`. Inject `ModuleSessionNotesService`. Change all three `@GrpcMethod('MeditationNotesService', …)` decorator strings to `@GrpcMethod('ModuleSessionNotesService', …)`. In `createNote`, drop the `req.poseId` argument from the `service.create(...)` call (now `create(user.sub, req.sessionId || null, req.noteText)`). Use the renamed mapper `toProtoModuleSessionNote` (Task 7). Keep `@Payload()` + `@GrpcCurrentUser()` on every method and the existing `!user` guards.

- [x] **Task 7: Rename the proto mapper** (depends on Tasks 2, 3)
  Files: `src/grpc/grpc-mappers.ts`
  Rename `toProtoMeditationNote` → `toProtoModuleSessionNote`. Update its import of the entity to `ModuleSessionNote` (from `src/module-session-notes/entities/...`) and the proto type to `ModuleSessionNote as ModuleSessionNoteProto` (from `proto/generated/module_session_notes`). Remove the `poseId: entity.poseId` line from the returned object; keep `id`, `sessionId`, `noteText`, `createdAt`, `updatedAt`.

- [x] **Task 8: Rename the module and wire it up** (depends on Tasks 3, 5, 6)
  Files: `src/module-session-notes/module-session-notes.module.ts` (new), `src/meditation-notes/meditation-notes.module.ts` (delete), `src/app.module.ts`, `src/main.ts`
  - Move and rename class `MeditationNotesModule` → `ModuleSessionNotesModule`. Keep `imports: [AuthModule, TypeOrmModule.forFeature([ModuleSessionNote])]` — `AuthModule` is **required** so that `GrpcAuthInterceptor` (used on the controller) can resolve its `JwtService`, `SessionService`, and `PersonalAccessTokenService` dependencies. Keep `import { AuthModule } from '../users/auth.module';`. Register the renamed controller and service provider.
  - In `app.module.ts`: replace the `MeditationNotesModule` import and its entry in the `imports` array with `ModuleSessionNotesModule`.
  - In `main.ts`: change the gRPC `protoPath` entry `join(process.cwd(), 'proto', 'meditation_notes.proto')` → `'module_session_notes.proto'`.

- [x] **Task 9: Update the existing service spec** (depends on Tasks 3, 5)
  Files: `src/module-session-notes/module-session-notes.service.spec.ts` (new), `src/meditation-notes/meditation-notes.service.spec.ts` (delete)
  Move/rename the existing spec to match the renamed module. Update imports and references: `MeditationNotesService` → `ModuleSessionNotesService`, `MeditationNote` → `ModuleSessionNote`, and remove any `poseId` from test fixtures and `create(...)` call arguments. Do not add new test cases — only keep the existing ones compiling and passing.

After Task 9, ensure no stale references remain: grep for `meditation-notes`, `MeditationNote`, `meditation_notes`, `poseId`, and `pose_id` across `src/` and `proto/` and confirm only intentional matches remain (e.g. `meditation-poses` is a separate, untouched module). Run `npm run build` to confirm the project compiles.

## Commit Plan
- **Commit 1** (after tasks 1-2): "Rename proto contract to module session notes and drop pose_id"
- **Commit 2** (after tasks 3-4): "Rename note entity and add module_session_notes migration"
- **Commit 3** (after tasks 5-9): "Rename module session notes service, controller, mapper and module"
