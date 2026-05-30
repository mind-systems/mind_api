# Plan: GET /sessions/runs/:id/biometrics and GET /sessions/runs/:id/instructions

## Context
Extend the existing `SessionsModule` (which currently only lists runs) with two read-only endpoints that return flattened biometric and instruction samples for a single session, filtered by an optional ISO 8601 time window. Used by the web dashboard's ECharts chart that fetches data per visible time window.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Verified write-path shapes

Confirmed by reading `src/realtime/interfaces/bio-session-buffer.interface.ts` and `src/realtime/interfaces/session-buffer.interface.ts`:

- **Biometrics sample (jsonb element):** `{ timestamp: number, sampleType: string, data: unknown }` — `timestamp` is **client unix-ms** (not an ISO string).
- **Instructions sample (jsonb element):** `{ timestamp: number, data: unknown }` — `timestamp` is **unix-ms**. Note: the roadmap and spec both say `{ timestamp, type, payload }` but the actual written shape is `{ timestamp, data }`; the service must pass the jsonb element through verbatim, not invent missing fields.

This pins down two earlier ambiguities: the per-sample filter uses numeric (`number`) comparison, not string/Date parsing, so the previous string-compare sort and ISO 8601 normalization concerns vanish.

## Design Decisions

These decisions resolve the issues flagged in plan review 2. Apply uniformly across both endpoints.

1. **Argument order:** all new service methods follow the existing `listRuns(userId, ...)` convention. Signatures are `(userId, sessionId, from?, to?)`. The ownership helper is `assertSessionOwnership(userId, sessionId)`.

2. **Window inclusivity (input):** the query string DTO accepts ISO 8601 strings; the service parses them to **unix-ms** (`new Date(from).getTime()`) to match the per-sample numeric `timestamp`. The window is `[fromMs, toMs)` — inclusive lower, exclusive upper.

3. **Coarse vs exact filter (review-2 Issue 1):**
   - Lower bound: apply `flushedAt >= fromDate` as a coarse filter. Sample-level `timestamp <= flushedAt`, so any batch with `flushedAt < from` has no sample inside the window — safe to drop.
   - Upper bound: **do not** apply a coarse `flushedAt < toDate` filter. A batch flushed *after* `to` can still contain samples whose own `timestamp` falls inside `[from, to)`. The per-sample post-filter does all upper-bound work. (`take` cap below bounds DB cost.)

4. **Row cap that fails loudly (review-2 Issue 2):** set `take: 60_000` on the batch-row query so it comfortably exceeds the 50,000 flatten cap. With minimum 1 sample per batch the flatten cap is guaranteed to fire first. Additionally, after fetching rows, if `rows.length === take` throw `PayloadTooLargeException` so the user is never silently truncated regardless of samples-per-batch.

5. **Response cap:** hard cap the post-flatten array at **50,000 elements**. If the cap is hit, throw `PayloadTooLargeException` (from `@nestjs/common`) with message `Result set too large; narrow the time window`. Comparison is `flat.length >= 50_000` (off-by-one fix from review 2). The dashboard always supplies a visible-window range; this protects against accidental full-session fetches.

6. **In-flight sessions are queryable (review-2 Issue 4):** the ownership check does **not** require `endedAt IS NOT NULL`. This is intentional — the dashboard's live-session view needs to read biometrics/instructions while a session is still active. The "completed only" filter in `listRuns` is a list-view convenience, not a security boundary; UUIDs are not guessable and the ownership comparison still gates access. Add a one-line comment in `assertSessionOwnership` noting this.

7. **Sort after flatten:** sort the flat array by numeric `timestamp` ASC so samples from adjacent batches present chronologically. Comparator: `(a, b) => Number(a['timestamp']) - Number(b['timestamp'])`.

## Tasks

### Phase 1: Wire entities and shared ownership check

- [x] **Task 1: Register sample entities in SessionsModule**
  Files: `src/sessions/sessions.module.ts`
  Add `BioSessionSample` (`src/realtime/entities/bio-session-sample.entity.ts`) and `SessionStreamSample` (`src/realtime/entities/session-stream-sample.entity.ts`) to the `TypeOrmModule.forFeature([...])` array, next to the existing `ModuleSession`. Extend the existing module-level comment (lines 4-7) so it also covers these two entities: state that `BioSessionSample` and `SessionStreamSample` are write-owned by `RealtimeModule` and read-only here for the web dashboard; registering them in both modules is intentional and gives `SessionsService` its own scoped repository without crossing module boundaries.

- [x] **Task 2: Create a shared time-range query DTO**
  Files: `src/sessions/dto/time-range-query.dto.ts`
  Create `TimeRangeQueryDto` with two optional fields: `from?: string` and `to?: string`. Decorate both with `@IsOptional()` + `@IsISO8601()` from `class-validator`. This DTO is reused by both new endpoints. Match the formatting style of the existing `ListRunsQueryDto` (`src/sessions/dto/list-runs-query.dto.ts`).

- [x] **Task 3: Rename existing repo and add ownership check helper to SessionsService** (depends on Task 1)
  Files: `src/sessions/sessions.service.ts`
  Two coordinated changes:
  - **Rename the existing repo field.** In the constructor, change `@InjectRepository(ModuleSession) private readonly repo: Repository<ModuleSession>` to `@InjectRepository(ModuleSession) private readonly moduleSessionRepo: Repository<ModuleSession>`. Update every reference inside `listRuns` (currently `this.repo.findAndCount(...)`) to `this.moduleSessionRepo.findAndCount(...)`. Verify with a grep that no other reference to `this.repo` remains in the file.
  - **Add the ownership helper:**
    ```ts
    private async assertSessionOwnership(userId: string, sessionId: string): Promise<void>
    ```
    Implementation:
    - `const session = await this.moduleSessionRepo.findOne({ where: { id: sessionId } })`. No `endedAt` filter — in-flight sessions are intentionally queryable (see Design Decision #6).
    - If `null` → throw `NotFoundException` (from `@nestjs/common`).
    - If `session.userId !== userId` → throw `ForbiddenException` (from `@nestjs/common`).
    - Return void — callers only need the access decision.

### Phase 2: Biometrics endpoint

- [x] **Task 4: Add biometrics service method** (depends on Task 3)
  Files: `src/sessions/sessions.service.ts`
  Inject `@InjectRepository(BioSessionSample) bioSampleRepo: Repository<BioSessionSample>` alongside `moduleSessionRepo`. Add:
  ```ts
  async listBiometrics(
    userId: string,
    sessionId: string,
    from?: string,
    to?: string,
  ): Promise<Record<string, unknown>[]>
  ```
  Steps:
  - Call `await this.assertSessionOwnership(userId, sessionId)`.
  - Parse window bounds. The DTO has already validated ISO 8601; convert to unix-ms (the on-disk `timestamp` field is numeric unix-ms):
    ```ts
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const fromMs = fromDate?.getTime();
    const toMs = toDate?.getTime();
    ```
  - Build `where: FindOptionsWhere<BioSessionSample> = { moduleSessionId: sessionId }`. Coarse `flushedAt` filter — **lower bound only** (see Design Decision #3):
    ```ts
    if (fromDate) where.flushedAt = MoreThanOrEqual(fromDate);
    ```
    Import `MoreThanOrEqual`, `FindOptionsWhere` from `typeorm`.
  - Query the batch rows with a cap chosen to make the flatten cap fail first (see Design Decision #4):
    ```ts
    const ROW_CAP = 60_000;
    const FLAT_CAP = 50_000;
    const rows = await this.bioSampleRepo.find({
      where,
      order: { flushedAt: 'ASC' },
      take: ROW_CAP,
    });
    if (rows.length === ROW_CAP) {
      throw new PayloadTooLargeException('Result set too large; narrow the time window');
    }
    ```
  - Flatten and apply the exact per-sample filter on numeric `timestamp`:
    ```ts
    // `timestamp` is client unix-ms (verified write-path). flushedAt is only a coarse filter;
    // the per-sample timestamp is authoritative for the [from, to) window.
    const flat: Record<string, unknown>[] = [];
    for (const row of rows) {
      for (const sample of row.samples ?? []) {
        const ts = typeof sample['timestamp'] === 'number' ? sample['timestamp'] : undefined;
        if (ts === undefined) {
          // Defensive: skip malformed samples rather than crashing the whole request.
          continue;
        }
        if (fromMs !== undefined && ts < fromMs) continue;
        if (toMs !== undefined && ts >= toMs) continue;
        flat.push(sample);
        if (flat.length >= FLAT_CAP) {
          throw new PayloadTooLargeException('Result set too large; narrow the time window');
        }
      }
    }
    ```
  - Sort by numeric `timestamp` so interleaved samples across adjacent batches present chronologically:
    ```ts
    flat.sort((a, b) => Number(a['timestamp']) - Number(b['timestamp']));
    ```
  - `return flat;`
  Each element is the raw jsonb sample shape `{ timestamp, sampleType, data }` — the service does not transform it.

- [x] **Task 5: Add biometrics route to SessionsController** (depends on Tasks 2, 4)
  Files: `src/sessions/sessions.controller.ts`
  Add:
  ```ts
  @Get('runs/:id/biometrics')
  listBiometrics(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: TimeRangeQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sessionsService.listBiometrics(user.sub, id, query.from, query.to);
  }
  ```
  Argument order matches the service: `(userId, sessionId, from, to)`. Add `Param`, `ParseUUIDPipe` to the `@nestjs/common` imports (`Query` is already imported by the existing `listRuns` route). Import `TimeRangeQueryDto` from `./dto/time-range-query.dto`. The class-level `@UseGuards(JwtAuthGuard)` already covers this route.

### Phase 3: Instructions endpoint

- [x] **Task 6: Add instructions service method** (depends on Task 3)
  Files: `src/sessions/sessions.service.ts`
  Inject `@InjectRepository(SessionStreamSample) streamSampleRepo: Repository<SessionStreamSample>`. Add:
  ```ts
  async listInstructions(
    userId: string,
    sessionId: string,
    from?: string,
    to?: string,
  ): Promise<Record<string, unknown>[]>
  ```
  Identical algorithm to `listBiometrics` (Task 4) — same ownership check, same `flushedAt >= from` coarse filter (no upper coarse bound), same `ROW_CAP = 60_000` / `FLAT_CAP = 50_000` overflow logic, same numeric per-sample `timestamp` filter, same sort by numeric `timestamp`. Only the injected repo differs (`streamSampleRepo`).

  The verified instruction element shape is `{ timestamp: number, data: unknown }` (no `type` / `payload` field). The service passes the jsonb element through verbatim — do not rename or add fields.

  Refactor opportunity: the two methods are identical except for the repository. If duplication feels uncomfortable, extract a private helper:
  ```ts
  private async listSamples<T extends { samples: Record<string, unknown>[]; flushedAt: Date }>(
    repo: Repository<T>,
    sessionId: string,
    from?: string,
    to?: string,
  ): Promise<Record<string, unknown>[]>
  ```
  Either choice is fine — the duplication is small.

- [x] **Task 7: Add instructions route to SessionsController** (depends on Tasks 2, 6)
  Files: `src/sessions/sessions.controller.ts`
  Add:
  ```ts
  @Get('runs/:id/instructions')
  listInstructions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: TimeRangeQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sessionsService.listInstructions(user.sub, id, query.from, query.to);
  }
  ```
  Reuse the `TimeRangeQueryDto`, `Param`, and `ParseUUIDPipe` imports added in Task 5.

## Commit Plan
- **Commit 1** (after tasks 1-3): Register sample entities and add shared ownership check to SessionsModule
- **Commit 2** (after tasks 4-7): Add biometrics and instructions endpoints with time-range filtering

<!-- orchestrator-sessions
planner: 3bac6564-0105-45c1-8ca6-31e627d055e0
elapsed: 1449
implementer: d0b528d0-90b7-4174-9503-8638b9cc723e
-->
