# Plan: breath-sessions.grpc.controller.ts

## Context
Implement a gRPC controller for the BreathSessionsService, following the same pattern established by `auth.grpc.controller.ts` and `users.grpc.controller.ts`. The controller translates between proto-generated types and existing service methods, with interim manual auth via gRPC metadata (pending the `GrpcAuthInterceptor` from roadmap 1.4).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Mapper functions

- [x] **Task 1: Add breath-session mapper functions to `grpc-mappers.ts`**
  Files: `src/grpc/grpc-mappers.ts`
  Add the following conversion functions:

  - `toProtoStepType(type: 'inhale' | 'exhale' | 'hold'): StepType` — maps entity string literals to the `StepType` enum from `proto/generated/breath_sessions.ts` (INHALE=0, EXHALE=1, HOLD=2).

  - `toProtoTimeOfDay(tod: TimeOfDay | null): ProtoTimeOfDay | undefined` — maps the entity `TimeOfDay` string enum (`'morning'`, `'midday'`, `'evening'`) to the proto numeric `TimeOfDay` enum (MORNING=0, MIDDAY=1, EVENING=2). Returns `undefined` when input is `null`.

  - `fromProtoTimeOfDay(tod: ProtoTimeOfDay): TimeOfDay` — reverse mapping from proto numeric enum to entity string enum. Used when passing gRPC request values into service methods.

  - `toProtoExerciseDto(exercise: BreathExercise): ExerciseDto` — maps entity `BreathExercise` (with `BreathStep[]`) to proto `ExerciseDto` (with `StepDto[]`), using `toProtoStepType` for each step.

  - `toProtoBreathSessionDto(session: BreathSession): BreathSessionDto` — maps a `BreathSession` entity to the proto `BreathSessionDto`. Converts `exercises` via `toProtoExerciseDto`, `timeOfDay` via `toProtoTimeOfDay`, timestamps via `.toISOString()`, and `deletedAt` to `undefined` when `null`.

  - `toProtoBreathSessionWithStarredDto(session: BreathSession & { isStarred?: boolean }): BreathSessionWithStarredDto` — wraps `toProtoBreathSessionDto` result into the composition-based `BreathSessionWithStarredDto { session, isStarred }`.

  - `fromProtoExercises(exercises: ExerciseDtoProto[]): BreathExerciseDto[]` — maps proto `ExerciseDto[]` to the DTO shape expected by `CreateBreathSessionDto` / `ReplaceBreathSessionDto` (step type as lowercase string, same numeric fields). Used by create, update, and replace handlers.

  Import entity types from `src/breath-sessions/entities/breath-session.entity.ts` and proto types from `proto/generated/breath_sessions.ts`. Use `import type` for interfaces. Follow the existing pattern in the file (pure functions, no class).

### Phase 2: Controller implementation

- [x] **Task 2: Create `breath-sessions.grpc.controller.ts`**
  Files: `src/breath-sessions/breath-sessions.grpc.controller.ts`
  Create the gRPC controller implementing `BreathSessionServiceController`. Follow the exact pattern from `auth.grpc.controller.ts`:

  **Class structure:**
  ```
  @Controller()
  @BreathSessionServiceControllerMethods()
  @UseFilters(GrpcExceptionFilter)
  export class BreathSessionsGrpcController implements BreathSessionServiceController
  ```

  **Constructor:** Inject `BreathSessionsService`, `BreathSessionSettingsService`, `JwtService`, and `SessionService`. `JwtService` and `SessionService` are needed for the interim manual auth pattern (same as `UsersGrpcController`).

  **Auth helper:** Add a private `extractUser(metadata?: Metadata)` method that extracts the Bearer token from `authorization` metadata, verifies JWT via `jwtService.verifyAsync<JwtPayload>()`, validates the session via `sessionService.isValid()`, and returns the `JwtPayload`. Throws `RpcException` with `UNAUTHENTICATED` on failure. This deduplicates auth logic across the 6 authenticated methods. Add a commented-out TODO referencing roadmap 1.4 for `GrpcAuthInterceptor` replacement, matching the style in existing controllers.

  **Optional auth helper:** Add a private `extractOptionalUser(metadata?: Metadata)` method for `listSessions`, `getSession`, and `batchGetSessions` — returns `JwtPayload | null`. If `authorization` metadata is missing, returns `null`. If present but invalid, throws `UNAUTHENTICATED`.

  **Method implementations (9 methods):**

  1. `createSession(request, metadata?)` — auth required. Map `request.exercises` via `fromProtoExercises`, map `request.timeOfDay` via `fromProtoTimeOfDay` (if present). Call `breathSessionsService.create(userId, dto)`. Return via `toProtoBreathSessionDto`.

  2. `listSessions(request, metadata?)` — auth optional. Call `breathSessionsService.findList(userId | null, request.page, request.pageSize)`. Map `result.data` via `toProtoBreathSessionWithStarredDto`. Return `{ data, total, page, pageSize }`.

  3. `getSuggestions(request, metadata?)` — auth required. Map `request.timeOfDay` via `fromProtoTimeOfDay`. Call `breathSessionsService.findSuggestions(userId, timeOfDay)`. Map results via `toProtoBreathSessionDto`. Return `{ suggestions }`.

  4. `batchGetSessions(request, metadata?)` — auth optional. Validate `request.ids.length` is between 1 and 50, throw `INVALID_ARGUMENT` if not. Call `breathSessionsService.findBatch(request.ids, userId | null)`. Map results via `toProtoBreathSessionWithStarredDto`. Return `{ sessions }`.

  5. `getSession(request, metadata?)` — auth optional. Call `breathSessionsService.findOne(request.id, userId | null)`. Return via `toProtoBreathSessionWithStarredDto`.

  6. `updateSession(request, metadata?)` — auth required. Build an update DTO: include `description` only if `request.description !== undefined`; unwrap `request.exercises?.exercises` via `fromProtoExercises` only if the `ExerciseList` wrapper is present (PATCH presence tracking); include `shared` and `timeOfDay` only if present. Call `breathSessionsService.update(request.id, userId, dto)`. Return via `toProtoBreathSessionDto`.

  7. `replaceSession(request, metadata?)` — auth required. Map all required fields (`description`, `exercises` via `fromProtoExercises`, `shared`) and optional `timeOfDay`. Call `breathSessionsService.replace(request.id, userId, dto)`. Return via `toProtoBreathSessionDto`.

  8. `updateSessionSettings(request, metadata?)` — auth required. Call `breathSessionsService.findOne(request.id)` to verify session exists (matches HTTP controller pattern). Then call `breathSessionSettingsService.upsert(userId, request.id, { starred: request.starred })`. Return `{ starred }`.

  9. `deleteSession(request, metadata?)` — auth required. Call `breathSessionsService.remove(request.id, userId)`. Return `{ message: 'Breath session deleted successfully' }`.

### Phase 3: Module registration

- [x] **Task 3: Register gRPC controller in `BreathSessionsModule`** (depends on Task 2)
  Files: `src/breath-sessions/breath-sessions.module.ts`
  Add `BreathSessionsGrpcController` to the `controllers` array alongside the existing `BreathSessionsController`. The module already imports `AuthModule` which exports `JwtService` and `SessionService` — verify these are available; if `JwtService` is not exported by `AuthModule`, add `JwtModule` to `BreathSessionsModule` imports (check `auth.module.ts` exports first). Follow the pattern from how `AuthGrpcController` was registered in `AuthModule`.

## Commit Plan
- **Commit 1** (after task 1): "Add breath-session proto mapper functions"
- **Commit 2** (after tasks 2-3): "Implement BreathSessions gRPC controller"
