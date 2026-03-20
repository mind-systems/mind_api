# Plan: Batch Fetch Endpoint

## Context
Add `GET /breath_sessions/batch?ids=uuid1,uuid2,...` to fetch multiple sessions in a single request, applying the same read-access rules as the existing `findOne` (any session readable by ID, `isStarred` augmented when authenticated). Capped at 50 IDs.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: DTO & Validation

- [x] **Task 1: Create BatchQueryDto**
  Files: `src/breath-sessions/dto/breath-session.dto.ts`
  Add a `BatchQueryDto` class at the end of the existing DTO file (all DTOs for this module live here). Fields:
  - `ids: string` — required, the raw comma-separated query string value.
  Apply `@IsNotEmpty()` and a custom inline validation: use `@Matches()` or `@Transform()` + `@ArrayMaxSize(50)` + `@IsUUID('4', { each: true })` pattern.
  Recommended approach (consistent with existing `@Type(() => Number)` coercion pattern in `ListQueryDto`):
  ```
  @Transform(({ value }) => value.split(',').map(s => s.trim()).filter(Boolean))
  @IsArray()
  @ArrayMaxSize(50, { message: 'Maximum 50 IDs per request' })
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  ids: string[];
  ```
  The `@Transform` converts the comma-separated string into an array before validation runs (works because `transform: true` is set globally). After transformation `ids` is `string[]`.
  Add `@ApiProperty({ description: 'Comma-separated session UUIDs (max 50)', example: 'uuid1,uuid2' })` for Swagger.
  Import `Transform` from `class-transformer` and `IsArray`, `ArrayMaxSize`, `ArrayMinSize`, `IsUUID` from `class-validator` (add to existing import block).

### Phase 2: Service & Controller

- [x] **Task 2: Add findBatch method to the service** (depends on Task 1)
  Files: `src/breath-sessions/breath-sessions.service.ts`
  Add an `async findBatch(ids: string[], userId: string | null)` method. Logic:
  - Query `this.breathSessionsRepo.find({ where: { id: In(ids) } })` to fetch all matching sessions in one query. Import `In` from `typeorm`.
  - If `userId` is provided: call `this.settingsService.findByUserAndSessions(userId, ids)` (this method already exists and accepts an array) to get starred status, then map `isStarred` onto each session — same pattern used in `findList`.
  - If `userId` is null: return sessions as-is (no `isStarred`), same as `findOne` does for anonymous access.
  - Sessions that don't exist are silently omitted (no 404 — partial results are fine for batch).

- [x] **Task 3: Add batch controller route** (depends on Task 2)
  Files: `src/breath-sessions/breath-sessions.controller.ts`
  Add a `findBatch` method. Place it **before** the `:id` param routes (near `findList` / `suggestions`) to avoid route shadowing (`batch` being captured as `:id`).
  Decorators:
  - `@UseGuards(OptionalJwtAuthGuard)` — same as `findOne`, anonymous access allowed.
  - `@Get('batch')`
  - `@ApiOperation({ summary: 'Fetch multiple breath sessions by IDs' })`
  - `@ApiResponse({ status: 200, type: [BreathSession] })`
  - `@ApiQuery({ name: 'ids', required: true, description: 'Comma-separated UUIDs (max 50)' })`
  Method signature: `async findBatch(@Request() req, @Query() query: BatchQueryDto)`.
  Extract `userId = req.user?.sub ?? null` (same pattern as `findOne`), call `this.breathSessionsService.findBatch(query.ids, userId)`, return the result directly.
