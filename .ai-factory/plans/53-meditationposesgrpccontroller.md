# Plan: MeditationPosesGrpcController

## Context
Expose the already-implemented `MeditationPosesService` over gRPC via a single auth-required `ListPoses` RPC, modelled on `MeditationNotesGrpcController`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Reconnaissance findings

The target deliverable already exists in the codebase from prior milestones (plans 50 and 52):

- `src/meditation-poses/meditation-poses.grpc.controller.ts` — `MeditationPosesGrpcController` exists with `@Controller()`, `@UseFilters(GrpcExceptionFilter)`, `@UseInterceptors(GrpcAuthInterceptor)`, and a single `@GrpcMethod('MeditationPosesService', 'listPoses')` handler. It throws `UNAUTHENTICATED` when `user` is null, delegates to `svc.listAll()`, and returns `{ poses: poses.map(toProtoMeditationPose) }`.
- `src/grpc/grpc-mappers.ts` — `toProtoMeditationPose` maps `id`, `slug`, `displayOrder` 1:1 (no Date fields).
- `src/meditation-poses/meditation-poses.module.ts` — declares the controller, imports `AuthModule` + `TypeOrmModule.forFeature([MeditationPose])`.
- `src/app.module.ts` — `MeditationPosesModule` is imported and registered.
- `src/main.ts` — `proto/meditation_poses.proto` is registered under the `mind` package.
- The handler uses `@Payload() _req: Empty` (request param is decorated, per project RULES.md gRPC requirement) and contains no non-null assertions.

Because the implementation is complete and already conforms to the spec (`.ai-factory/notes/35-meditation-poses-grpc-controller.md`) and project rules, this plan is reduced to a verification pass. No source changes are expected; only create/correct files if a check below fails.

## Tasks

### Phase 1: Verify endpoint contract

- [x] **Task 1: Confirm controller conformance**
  Files: `src/meditation-poses/meditation-poses.grpc.controller.ts`
  Verify the controller matches the spec: class decorators `@Controller()`, `@UseFilters(GrpcExceptionFilter)`, `@UseInterceptors(GrpcAuthInterceptor)`; single `@GrpcMethod('MeditationPosesService', 'listPoses')` handler; request param decorated with `@Payload()`; `@GrpcCurrentUser() user: JwtPayload | null` injected; throws `RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' })` when `user` is null; delegates to `meditationPosesService.listAll()`; returns `{ poses: poses.map(toProtoMeditationPose) }`. No non-null assertion (`!`) is used. If any element is missing, correct it to match `MeditationNotesGrpcController`'s pattern and the spec note `.ai-factory/notes/35-meditation-poses-grpc-controller.md`.

- [x] **Task 2: Confirm wiring** (depends on Task 1)
  Files: `src/meditation-poses/meditation-poses.module.ts`, `src/app.module.ts`, `src/main.ts`
  Verify `MeditationPosesGrpcController` is registered in `MeditationPosesModule.controllers`, that `MeditationPosesModule` is imported by `AppModule`, and that `proto/meditation_poses.proto` is in the gRPC `protoPath` list under the `mind` package in `main.ts`. If any wiring is missing, add it.

- [x] **Task 3: Build verification** (depends on Task 2)
  Files: (none — build only)
  Run `npm run build` and confirm it compiles with no TypeScript errors. If it fails, fix the reported issue in the relevant file above.
