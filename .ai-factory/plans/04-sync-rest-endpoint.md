# Plan: Sync REST Endpoint

## Context
Add a `GET /sync/changes` endpoint that returns change events after a given cursor, enabling the mobile client to pull incremental sync data. When the requested cursor is too old (pruned by TTL), the endpoint signals the client to perform a full resync instead.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: DTOs and service

- [x] **Task 1: Create sync DTOs**
  Files: `src/sync/dto/sync-changes.dto.ts`
  Create three classes:
  - `SyncChangesQueryDto` — query parameters: `after` (number, required, `@Type(() => Number)`), `limit` (number, optional, default 100, max 100, `@Type(() => Number)`). Decorate with `class-validator` (`@IsInt`, `@Min(0)`, `@Max(100)`, `@IsOptional`) and `@ApiProperty`.
  - `SyncChangesResponseDto` — success response: `events` (array of `SyncEventDto`), `cursor` (number), `hasMore` (boolean). All fields decorated with `@ApiProperty`.
  - `SyncEventDto` — single event shape mirroring `ChangeEvent` entity fields exposed to the client: `id` (number), `entity` (string), `refId` (string), `action` (string), `createdAt` (Date). Do not expose `userId` — the endpoint is already scoped to the authenticated user.
  - `SyncFullResyncResponseDto` — resync signal: `fullResync` (boolean, always `true`). Decorated with `@ApiProperty`.

- [x] **Task 2: Create SyncService**
  Files: `src/sync/sync.service.ts`
  Inject `ChangeLogService` (available globally, no module import needed).
  Single method `getChanges(userId: string, afterId: number, limit: number)`:
  1. Call `changeLogService.getMinEventId()`.
  2. If `minEventId` is not null and `afterId !== 0` and `afterId < minEventId` — return `{ fullResync: true as const }`.
  3. Otherwise call `changeLogService.getChanges(userId, afterId, limit)` and return the result (`{ events, cursor, hasMore }`).
  Return type: `ChangesResult | { fullResync: true }` (import `ChangesResult` from `changelog.service`).

### Phase 2: Controller and module registration

- [x] **Task 3: Create SyncController**
  Files: `src/sync/sync.controller.ts`
  Follow the existing controller pattern from `BreathSessionsController`:
  - `@Controller('sync')`, `@ApiTags('sync')`.
  - Single route `@Get('changes')` protected by `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()`.
  - Extract user ID via `@Request() req` → `req.user.sub` (same pattern as breath-sessions controller).
  - Accept `@Query() query: SyncChangesQueryDto` (NestJS `ValidationPipe` handles transform + validation).
  - Call `syncService.getChanges(userId, query.after, query.limit)`.
  - If the result contains `fullResync`, return it directly (200). Otherwise return the events/cursor/hasMore object (200).
  - Swagger: `@ApiOperation({ summary: 'Get change events for sync' })`, `@ApiResponse` for 200 (document both possible shapes), 401.

- [x] **Task 4: Create SyncModule and register in AppModule**
  Files: `src/sync/sync.module.ts`, `src/app.module.ts`
  - `SyncModule`: imports `AuthModule` (for `JwtAuthGuard`), declares `SyncController` and `SyncService`. No entity imports needed — `ChangeLogService` is global and owns the `ChangeEvent` repository.
  - `AppModule`: add `SyncModule` to the `imports` array alongside existing modules.

## Commit Plan
- **Commit 1** (after tasks 1-4): "Add sync REST endpoint for incremental change pull"
