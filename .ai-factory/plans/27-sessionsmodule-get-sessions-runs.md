# Plan: SessionsModule + GET /sessions/runs

## Context
Add a new REST endpoint `GET /sessions/runs?limit&offset` that returns the authenticated user's completed activity sessions (rows in `module_sessions` with `endedAt IS NOT NULL`) for the `mind_web` dashboard. This is a thin read-only HTTP layer over the existing `ModuleSession` entity owned by `RealtimeModule`. No new entity, no migration, no changes to `RealtimeModule`. Full spec: `.ai-factory/notes/10-web-dashboard-rest-api-spec.md` (Milestone 3).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: DTO and service

- [x] **Task 1: Create `ListRunsQueryDto` for query params**
  Files: `src/sessions/dto/list-runs-query.dto.ts`
  New class-validator DTO for the `GET /sessions/runs` query string. Fields:
  - `limit?: number` — `@Type(() => Number) @IsInt() @Min(1) @Max(200) @IsOptional()`. Default applied in the service (50) — DO NOT use `@DefaultValue` decorators; keep the DTO purely declarative.
  - `offset?: number` — `@Type(() => Number) @IsInt() @Min(0) @IsOptional()`. Default 0, applied in the service.
  Imports: `IsInt`, `Min`, `Max`, `IsOptional` from `class-validator`; `Type` from `class-transformer`.
  Rationale for `@Type(() => Number)`: query string values arrive as strings; without explicit type coercion `@IsInt` would reject them. The global `ValidationPipe` in `src/main.ts` already runs with `transform: true` (verify before writing), so the `@Type` decorator is honored. If it is not set globally, the implementer must either add `transform: true` at the pipe level OR add `new ValidationPipe({ transform: true })` at the controller level via `@UsePipes`.

- [x] **Task 2: Create `SessionsService` with `listRuns` method**
  Files: `src/sessions/sessions.service.ts`
  `@Injectable()` provider that uses `@InjectRepository(ModuleSession)` (import the entity from `../realtime/entities/module-session.entity`). Single public method:
  ```ts
  async listRuns(userId: string, limit?: number, offset?: number): Promise<{
    items: { id: string; startedAt: Date; endedAt: Date; durationSeconds: number }[];
    total: number;
  }>
  ```
  Implementation details:
  - `const take = Math.min(limit ?? 50, 200);`
  - `const skip = offset ?? 0;`
  - Query: `this.repo.findAndCount({ where: { userId, endedAt: Not(IsNull()) }, order: { startedAt: 'DESC' }, take, skip });`
  - Imports for predicates: `Not`, `IsNull` from `typeorm`.
  - Map `[rows, total]` into the response shape. For each row build `durationSeconds = Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000)`. The TypeORM filter guarantees `endedAt` is not null, but TypeScript still sees the entity field as optional — add a narrowing check inside the map (`if (!row.endedAt) continue;` or `if (!row.endedAt) throw new Error('unexpected null endedAt');`) instead of using the `!` non-null assertion. Per `.ai-factory/RULES.md`, `!` is forbidden.
  - Return `{ items, total }`.
  No logging in the success path. No try/catch — let TypeORM errors propagate to the NestJS global exception filter.

### Phase 2: Controller

- [x] **Task 3: Create `SessionsController` exposing `GET /sessions/runs`** (depends on Tasks 1, 2)
  Files: `src/sessions/sessions.controller.ts`
  ```ts
  @Controller('sessions')
  @UseGuards(JwtAuthGuard)
  export class SessionsController {
    constructor(private readonly sessionsService: SessionsService) {}

    @Get('runs')
    listRuns(
      @Query() query: ListRunsQueryDto,
      @CurrentUser() user: JwtPayload,
    ) {
      return this.sessionsService.listRuns(user.sub, query.limit, query.offset);
    }
  }
  ```
  Imports:
  - `Controller`, `Get`, `Query`, `UseGuards` from `@nestjs/common`
  - `JwtAuthGuard` from `../users/guards/jwt-auth.guard`
  - `CurrentUser` from `../users/decorators/current-user.decorator`
  - `JwtPayload` from `../users/interfaces/auth.interface`
  - `ListRunsQueryDto` from `./dto/list-runs-query.dto`
  - `SessionsService` from `./sessions.service`
  Controller is thin — only request/response shaping per `.ai-factory/ARCHITECTURE.md`. No business logic.

### Phase 3: Module wiring

- [x] **Task 4: Create `SessionsModule`** (depends on Tasks 2, 3)
  Files: `src/sessions/sessions.module.ts`
  ```ts
  @Module({
    imports: [
      TypeOrmModule.forFeature([ModuleSession]),
      AuthModule,
    ],
    controllers: [SessionsController],
    providers: [SessionsService],
  })
  export class SessionsModule {}
  ```
  Imports:
  - `Module` from `@nestjs/common`
  - `TypeOrmModule` from `@nestjs/typeorm`
  - `ModuleSession` from `../realtime/entities/module-session.entity`
  - `AuthModule` from `../users/auth.module` (re-exports `JwtAuthGuard` — see `src/users/auth.module.ts:53-62`)
  - `SessionsController` from `./sessions.controller`
  - `SessionsService` from `./sessions.service`
  Importing `ModuleSession` via `TypeOrmModule.forFeature` in a second module is supported by TypeORM and produces an additional repository registration for this module's DI scope. Do NOT modify `RealtimeModule`, do NOT re-export the repository, do NOT export `SessionsService` (nothing depends on it).

- [x] **Task 5: Register `SessionsModule` in `AppModule`** (depends on Task 4)
  Files: `src/app.module.ts`
  Add `import { SessionsModule } from './sessions/sessions.module';` near the other module imports and append `SessionsModule` to the `imports` array in `@Module`. Place it after `SyncModule` to preserve the existing ordering convention. No other changes to `AppModule`.

## Notes

- **Entity ownership note.** `ModuleSession` is owned by `RealtimeModule` semantically (write path). `SessionsModule` is a read-only consumer for the dashboard. The roadmap entry explicitly allows registering the same entity in `TypeOrmModule.forFeature` in both modules — this is a deliberate exception to the "entities stay in their module" guideline in `.ai-factory/ARCHITECTURE.md` because adding a read API on `RealtimeModule` (a streaming/realtime module) would muddle that module's responsibility. Document this in the module file with a brief comment so future maintainers don't "fix" it.
- **Auth.** `JwtAuthGuard` is exported from `AuthModule` (`src/users/auth.module.ts:56`) and reads the JWT into `request.user` as `JwtPayload`. `JwtPayload.sub` is the user id — use it directly as `userId` in the query (no extra DB lookup).
- **Validation pipe sanity check.** Before relying on `@Type(() => Number)` in `ListRunsQueryDto`, verify `src/main.ts` enables a global `ValidationPipe` with `transform: true`. If it does not, either enable it globally or attach a transforming `ValidationPipe` at this controller/route level. Do not silently leave `limit`/`offset` as strings — `Math.min('200', 200)` returns the string and breaks pagination.
- **Pagination ceiling.** `take = Math.min(limit ?? 50, 200)` enforces the 200-row cap server-side even if the client sends a larger value, matching the spec.
- **No new migration.** `module_sessions` already exists and is indexed on `userId` (see `@Index(['userId'])` in `module-session.entity.ts`); the `ORDER BY startedAt DESC` is acceptable for a per-user list at expected volumes. If query plans degrade later, a composite `(userId, startedAt)` index can be added — out of scope for this milestone.
- **Rules compliance.** No `!` non-null assertions anywhere. No logging of user id, emails, or any session contents (`.ai-factory/RULES.md`).
- **All output in English** per project conventions.

<!-- orchestrator-sessions
planner: 0aefc416-530e-4166-9757-34bb3119bb6c
elapsed: 585
implementer: 227b487c-5a94-422f-9694-b3f1da5b0392
-->
