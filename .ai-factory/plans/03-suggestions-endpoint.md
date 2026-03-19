# Plan: Suggestions Endpoint

## Context
Add a `GET /breath_sessions/suggestions?timeOfDay=X` endpoint that returns a random selection of 3–4 breath sessions owned by the authenticated user, filtered by the requested time-of-day slot (morning, midday, or evening). The `TimeOfDay` enum and the `timeOfDay` column on `breath_sessions` already exist — no migration needed.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: DTO

- [x] **Task 1: Create SuggestionsQueryDto**
  Files: `src/breath-sessions/dto/breath-session.dto.ts`
  Add a `SuggestionsQueryDto` class in the existing DTO file. It should have a single required field `timeOfDay` of type `TimeOfDay` (the enum from `../enums/time-of-day.enum.ts`). Apply `@IsEnum(TimeOfDay)`, `@IsNotEmpty()`, and `@ApiProperty({ enum: TimeOfDay })` decorators. Use `@Transform` or plain `@IsEnum` — the value arrives as a query string so no type coercion is needed since the enum values are already strings.

### Phase 2: Service

- [x] **Task 2: Add `findSuggestions` method to BreathSessionsService** (depends on Task 1)
  Files: `src/breath-sessions/breath-sessions.service.ts`
  Add an async method `findSuggestions(userId: string, timeOfDay: TimeOfDay): Promise<BreathSession[]>` that:
  1. Queries `breath_sessions` where `userId = :userId AND timeOfDay = :timeOfDay`.
  2. Uses `ORDER BY RANDOM()` and `LIMIT 4` to return a random subset of up to 4 matching sessions.
  Use the QueryBuilder (same pattern as `findList`) — e.g. `this.breathSessionsRepository.createQueryBuilder('session').where('session.userId = :userId', { userId }).andWhere('session.timeOfDay = :timeOfDay', { timeOfDay }).orderBy('RANDOM()').limit(4).getMany()`.

### Phase 3: Controller

- [x] **Task 3: Add `GET /breath_sessions/suggestions` endpoint** (depends on Task 2)
  Files: `src/breath-sessions/breath-sessions.controller.ts`
  Add a new method `getSuggestions` to `BreathSessionsController`:
  - Decorator: `@Get('suggestions')` — place this method **above** the `@Get(':id')` route so NestJS matches it before the `:id` param route.
  - Guard: `@UseGuards(JwtAuthGuard)`.
  - Extract userId via `@Request() req` → `req.user.sub` (following the existing pattern in this controller).
  - Accept `@Query() query: SuggestionsQueryDto`.
  - Swagger: `@ApiOperation({ summary: 'Get random session suggestions for a time of day' })`, `@ApiOkResponse({ type: [BreathSession] })`, `@ApiBearerAuth()`.
  - Delegates to `this.breathSessionsService.findSuggestions(userId, query.timeOfDay)` and returns the result directly.
