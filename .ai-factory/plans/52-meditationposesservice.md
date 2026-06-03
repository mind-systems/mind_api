# Plan: MeditationPosesService

## Context
Give `MeditationPosesService` a single `listAll()` method that returns all meditation poses ordered by `displayOrder ASC` — global reference data with no user context, filtering, or pagination, per spec `.ai-factory/notes/34-meditation-poses-service.md`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Align service method with spec

- [x] **Task 1: Rename service method to `listAll()`**
  Files: `src/meditation-poses/meditation-poses.service.ts`
  The service currently exposes `listPoses()` with the correct implementation (`this.repo.find({ order: { displayOrder: 'ASC' } })`). Rename the method to `listAll(): Promise<MeditationPose[]>` to match the milestone spec. Keep the body unchanged — `@InjectRepository(MeditationPose)` stays confined to this module, no error handling added (a failed DB read propagates naturally as an internal gRPC error).

- [x] **Task 2: Update the gRPC controller call site** (depends on Task 1)
  Files: `src/meditation-poses/meditation-poses.grpc.controller.ts`
  The `listPoses` gRPC handler calls `this.meditationPosesService.listPoses()`. Update that single call to `this.meditationPosesService.listAll()`. Leave everything else (auth check, `toProtoMeditationPose` mapping, response shape) untouched.

## Notes
- The module wiring (`TypeOrmModule.forFeature([MeditationPose])`, provider registration) already exists and needs no change.
- After the rename, verify with `npm run build` that compilation succeeds and there are no remaining references to `listPoses()` on the service.
- Single logical change → one commit, no commit plan needed.
