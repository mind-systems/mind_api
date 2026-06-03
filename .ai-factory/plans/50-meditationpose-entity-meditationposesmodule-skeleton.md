# Plan: `MeditationPose` entity + `MeditationPosesModule` skeleton

## Context
Wire up the `meditation_poses` domain: a TypeORM entity over the existing `meditation_poses` table plus a self-contained `MeditationPosesModule` (controller + service) serving the already-defined gRPC `ListPoses` RPC. The proto (`proto/meditation_poses.proto`), its generated stub (`proto/generated/meditation_poses.ts`), and the migration (`1780508172536-AddMeditationPosesTable.ts`) already exist — this milestone adds only the NestJS/TypeORM layer.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Entity & data access

- [x] **Task 1: Create the `MeditationPose` entity**
  Files: `src/meditation-poses/entities/meditation-pose.entity.ts`
  Define `@Entity('meditation_poses')` with exactly three columns and no timestamps / no user FK (table is immutable reference data):
  - `id` — `@PrimaryGeneratedColumn('uuid')` → `id: string`
  - `slug` — `@Column({ unique: true })` → `slug: string`
  - `displayOrder` — `@Column({ name: 'display_order', type: 'smallint' })` → `displayOrder: number`
  Column names/types must match the migration (`slug` varchar UNIQUE, `display_order` smallint). Mirror the import/structure style of `src/meditation-notes/entities/meditation-note.entity.ts` but drop `@CreateDateColumn`/`@UpdateDateColumn`.

- [x] **Task 2: Create `MeditationPosesService`**
  Files: `src/meditation-poses/meditation-poses.service.ts`
  `@Injectable()` service with `@InjectRepository(MeditationPose)` (confined to this module per the architecture dependency rules). Expose one method:
  - `listPoses(): Promise<MeditationPose[]>` → `this.repo.find({ order: { displayOrder: 'ASC' } })`.
  Follow the constructor/`InjectRepository` pattern from `src/meditation-notes/meditation-notes.service.ts`. Keep it lean — no logging.

### Phase 2: gRPC surface

- [x] **Task 3: Add proto mapper for `MeditationPose`** (depends on Task 1)
  Files: `src/grpc/grpc-mappers.ts`
  Add `toProtoMeditationPose(entity: MeditationPose): MeditationPoseProto` mapping `id`, `slug`, and `displayOrder → displayOrder` (proto field `display_order`, generated as `displayOrder: number`). Import the entity and the generated `MeditationPose` type from `../../proto/generated/meditation_poses` (alias the proto type, e.g. `MeditationPose as MeditationPoseProto`), mirroring the existing `toProtoMeditationNote` function.

- [x] **Task 4: Create `MeditationPosesGrpcController`** (depends on Tasks 2, 3)
  Files: `src/meditation-poses/meditation-poses.grpc.controller.ts`
  `@Controller()` decorated with `@UseFilters(GrpcExceptionFilter)` and `@UseInterceptors(GrpcAuthInterceptor)`, mirroring `src/meditation-notes/meditation-notes.grpc.controller.ts`. Implement one method:
  - `@GrpcMethod('MeditationPosesService', 'listPoses')` `async listPoses(@Payload() _req: Empty, @GrpcCurrentUser() user: JwtPayload | null): Promise<ListMeditationPosesResponse>`.
  - Reject when `user` is null with `RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' })` (poses are available to any authenticated user).
  - Return `{ poses: (await service.listPoses()).map(toProtoMeditationPose) }`.
  Import `ListMeditationPosesResponse` from `../../proto/generated/meditation_poses` and `Empty` from `../../proto/generated/google/protobuf/empty` (or the path used by the generated stub — match the existing import style). Keep the `@Payload()` + `@GrpcCurrentUser()` pairing per project rules.

### Phase 3: Module wiring

- [x] **Task 5: Create `MeditationPosesModule`** (depends on Tasks 2, 4)
  Files: `src/meditation-poses/meditation-poses.module.ts`
  ```ts
  @Module({
    imports: [AuthModule, TypeOrmModule.forFeature([MeditationPose])],
    controllers: [MeditationPosesGrpcController],
    providers: [MeditationPosesService],
  })
  export class MeditationPosesModule {}
  ```
  Import `AuthModule` from `../users/auth.module` (required for `GrpcAuthInterceptor`/`@GrpcCurrentUser` access control, matching `MeditationNotesModule`). No `exports` — nothing in other modules consumes `MeditationPosesService`.

- [x] **Task 6: Register `MeditationPosesModule` in `AppModule`** (depends on Task 5)
  Files: `src/app.module.ts`
  Add the import and place `MeditationPosesModule` in the `imports` array directly next to `MeditationNotesModule`.

- [x] **Task 7: Register the pose proto with the gRPC microservice** (depends on Task 4)
  Files: `src/main.ts`
  Add `join(process.cwd(), 'proto', 'meditation_poses.proto')` to the `protoPath` array in the `connectMicroservice` GRPC options (next to `meditation_notes.proto`). Without this, the `MeditationPosesService` RPC is not served.

## Commit Plan
- **Commit 1** (after tasks 1-2): "Add MeditationPose entity and service"
- **Commit 2** (after tasks 3-4): "Add MeditationPoses gRPC controller and proto mapper"
- **Commit 3** (after tasks 5-7): "Wire MeditationPosesModule into app and gRPC server"
