# Plan: Add `activityType`, `description`, and `complexity` to `GET /sessions/runs` response

## Context
Extend the `GET /sessions/runs` list response with `activityType` (always) plus `description` and `complexity` (breath-only), resolved in a single query that left-joins `breath_sessions`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Implementation

- [x] **Task 1: Register `BreathSession` in `SessionsModule`**
  Files: `src/sessions/sessions.module.ts`
  Import `BreathSession` from `../breath-sessions/entities/breath-session.entity` and add it to the existing `TypeOrmModule.forFeature([...])` array (alongside `ModuleSession`, `BioSessionSample`, `SessionStreamSample`). This is read-only access scoped to `SessionsModule` so `@InjectRepository(BreathSession)` becomes injectable in `SessionsService` without crossing module boundaries — mirror the rationale already documented in the file's header comment (entity owned by another module, registered here only for read access). The repository itself is not needed for the query (the join uses `ModuleSession`'s query builder), but registering the entity keeps the feature self-consistent and available; do not inject a `BreathSession` repository unless the implementation actually needs it — see Task 2's approach.

- [x] **Task 2: Replace `findAndCount` with a `createQueryBuilder` left-join in `listRuns`** (depends on Task 1)
  Files: `src/sessions/sessions.service.ts`
  Rewrite `SessionsService.listRuns` to resolve breath fields in one round-trip.
  - Import `ActivityType` from `../realtime/enums/activity-type.enum`.
  - Extend the method's return type: each item gains `activityType: ActivityType`, `description: string | null`, `complexity: number | null`.
  - Keep `take = Math.min(limit ?? 50, 200)` and `skip = offset ?? 0`.
  - Build the query on `this.moduleSessionRepo.createQueryBuilder('ms')`:
    - `.leftJoin('breath_sessions', 'bs', 'bs.id = ms."activityRefId" AND ms."activityType" = :breath AND bs."deletedAt" IS NULL', { breath: ActivityType.BREATH })` — the `activityType = 'breath'` guard prevents a meditation session's `activityRefId` (a pose config id) from matching a breath row.
    - `.where('ms.userId = :userId', { userId })` and `.andWhere('ms.endedAt IS NOT NULL')`.
    - `.orderBy('ms.startedAt', 'DESC')`.
    - `.addSelect(['bs.description', 'bs.complexity'])` so the joined columns appear in raw results.
  - Compute `total` via a separate `getCount()` on the same query **without** `take`/`skip` applied (clone/derive the count before adding pagination, or call `getCount()` before setting `take`/`skip`).
  - Fetch data with `.take(take).skip(skip).getRawAndEntities()` — `entities` and `raw` stay index-aligned.
  - Map each pair `(entities[i], raw[i])` to:
    `{ id, startedAt, endedAt, durationSeconds, activityType, description: raw.bs_description ?? null, complexity: raw.bs_complexity != null ? Number(raw.bs_complexity) : null }`.
    `durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)`. Postgres returns numeric columns as strings in raw results — coerce `complexity` with `Number(...)`.
  - Return `{ items, total }`.
  - Invariants to preserve: `userId` filter, `endedAt IS NOT NULL`, `startedAt DESC` order, `limit` capped at 200, `offset` honored, response shape `{ items, total }`. Do not add a per-row lookup — everything resolves in the single join query.
  - Verify the raw alias names: TypeORM prefixes `addSelect('bs.description')` raw keys as `bs_description` / `bs_complexity`; confirm against the generated SQL/alias and adjust the mapping keys if the join alias produces different names.
