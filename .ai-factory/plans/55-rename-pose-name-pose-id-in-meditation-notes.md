# Plan: Rename `pose_name` → `pose_id` in `meditation_notes`

## Context
Rename the `pose_name` slug column to `pose_id` across DB, entity, proto, and gRPC mapping so mobile can send a pose UUID after meditation poses ship. The column type stays `varchar`, no FK is added, and the table is empty so no data migration is needed. All changes must ship together — a partial rename breaks the running app.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Schema & entity

- [x] **Task 1: Create the rename migration**
  Files: `src/migrations/<generated>-RenamePoseNameToPoseIdInMeditationNotes.ts`
  Generate the file via CLI (never hand-craft the timestamp):
  ```bash
  npx typeorm migration:create src/migrations/RenamePoseNameToPoseIdInMeditationNotes
  ```
  `up()`: `ALTER TABLE meditation_notes RENAME COLUMN pose_name TO pose_id;`
  `down()`: `ALTER TABLE meditation_notes RENAME COLUMN pose_id TO pose_name;`
  No FK added — `pose_id` is a denormalised text snapshot by design (loose coupling, like `session_id ON DELETE SET NULL`).

- [x] **Task 2: Rename the entity field** (depends on Task 1)
  Files: `src/meditation-notes/entities/meditation-note.entity.ts`
  Rename `poseName` → `poseId` and update the column decorator to `@Column({ name: 'pose_id' })`. Keep type `string` (`varchar`).

### Phase 2: Proto contract

- [x] **Task 3: Rename the proto field and regenerate stubs** (depends on Task 2)
  Files: `proto/meditation_notes.proto`, `proto/generated/meditation_notes.ts`
  In `proto/meditation_notes.proto`, rename `pose_name` → `pose_id` in both `MeditationNote` (field `= 3`) and `CreateNoteRequest` (field `= 2`). Keep the existing field numbers — wire-safe. Also update the comment lines that mention `pose_name`. Regenerate stubs:
  ```bash
  npm run proto:gen
  ```
  This updates `proto/generated/meditation_notes.ts` (`poseName` → `poseId`). Do not hand-edit the generated file — let `proto:gen` produce it.

### Phase 3: Application code

- [x] **Task 4: Update the service** (depends on Task 2, Task 3)
  Files: `src/meditation-notes/meditation-notes.service.ts`
  Rename the `poseName` parameter → `poseId` in the create method signature and in the `this.repo.create({ ..., poseId, ... })` call.

- [x] **Task 5: Update the gRPC controller** (depends on Task 3, Task 4)
  Files: `src/meditation-notes/meditation-notes.grpc.controller.ts`
  In the `createNote` handler, pass `req.poseId` instead of `req.poseName` to the service call.

- [x] **Task 6: Update the entity→proto mapper** (depends on Task 2, Task 3)
  Files: `src/grpc/grpc-mappers.ts`
  In `toProtoMeditationNote`, change `poseName: entity.poseName` → `poseId: entity.poseId`.

## Verification
- `npm run build` compiles with zero remaining `poseName` / `pose_name` references in `src/` and `proto/`.
- Migration runs cleanly on the empty table (`npm run migration:run`).
- A `CreateNote` gRPC call with `pose_id: "<uuid>"` inserts a row with the UUID stored in `pose_id`.

## Commit Plan
- **Commit 1** (after tasks 1-6): "Rename pose_name to pose_id in meditation_notes" — single atomic commit; a partial rename breaks the running app, so all six changes ship together.
