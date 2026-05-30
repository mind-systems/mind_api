# Plan Review: GET /sessions/runs/:id/biometrics and GET /sessions/runs/:id/instructions

**Plan:** `.ai-factory/plans/28-get-sessions-runs-id-biometrics-and-get-sessions-runs-id-instructions.md`
**Risk Level:** 🔴 High (one critical correctness/security bug, several smaller issues)

## Context Gates

- **ARCHITECTURE.md:** OK — read-only consumer of realtime-owned entities aligns with the existing comment in `sessions.module.ts` (modules communicate via exported providers/scoped repos). No new architectural boundary is created.
- **RULES.md:** OK — no `!` non-null assertions are proposed; logging is set to `minimal`; no sensitive data is logged. The plan doesn't touch gRPC, so the `@Payload()` rule doesn't apply.
- **ROADMAP.md:** Not verified for explicit linkage of this task. WARN — orchestrator-task id `28` is referenced in the filename, which is the standard linkage; acceptable.

## Critical Issues

### 1. Controller passes arguments to the service in the wrong order (Task 5 AND Task 7) 🔴

The service signatures in Tasks 4 and 6 are:

```ts
listBiometrics(sessionId: string, userId: string, from?: string, to?: string)
listInstructions(sessionId: string, userId: string, from?: string, to?: string)
```

But the controller code shown in Task 5 / Task 7 calls them as:

```ts
this.sessionsService.listBiometrics(user.sub, id, query.from, query.to);
this.sessionsService.listInstructions(user.sub, id, query.from, query.to);
```

`user.sub` is the **userId** and `id` is the **sessionId** — they're swapped.

Consequences if implemented as written:
- `assertSessionOwnership(sessionId, userId)` would receive `(userId, sessionId)`, so `findOne({ where: { id: sessionId } })` would look up a `module_sessions` row whose `id` equals the JWT user's id — virtually always returning `null` → `NotFoundException` for every request. In the rare collision case it would compare `session.userId` to the real `sessionId` and throw `ForbiddenException`.
- Even past the ownership check, `where: { moduleSessionId: sessionId }` in `listBiometrics`/`listInstructions` would filter samples whose `moduleSessionId` matches the JWT user's id, returning nothing (or, with a collision, leaking another user's data).

This is both a correctness bug and a latent authorization bug. The plan's own prose ("the spec uses `sessionId, userId` — keep service-side order as written in Task 4; pass them in the same order from the controller") contradicts the snippet it shows. Required fix: either change service signature to `(userId, sessionId, ...)` to match the existing `listRuns(userId, ...)` convention, **or** change controller call to `(id, user.sub, query.from, query.to)`. Recommendation: match `listRuns` and use `(userId, sessionId, ...)` for consistency across the service.

## Issues

### 2. Inconsistent boundary inclusivity in `flushedAt` filter (Tasks 4 and 6)

The plan uses:
- both bounds → `Between(fromDate, toDate)` (inclusive on both sides — TypeORM `Between` is `>= AND <=`)
- only `from` → `MoreThanOrEqual(fromDate)` (inclusive)
- only `to` → `LessThan(toDate)` (**exclusive**)

The two-bound and one-bound paths disagree on the upper bound. Pick one convention. Most paginated time-window APIs use `[from, to)` (inclusive-lower, exclusive-upper). If you adopt that, replace `Between(...)` with `flushedAt: And(MoreThanOrEqual(fromDate), LessThan(toDate))` (or two `where` keys via `LessThan` + `MoreThanOrEqual` in a single object).

### 3. `flushedAt` is the wrong field for a time-window query

`flushedAt` is the server-side batch flush instant, not the sample timestamp. Each row's `samples` jsonb array contains entries with their own `timestamp` (per `docs/realtime/biometric-stream.md` envelope shape and the service contract `{ timestamp, sampleType, data }` / `{ timestamp, type, payload }`).

Results:
- A batch flushed at `T` may contain samples timestamped over several seconds before `T`, so a tight window can either over-include (return all samples in any overlapping flush row) or under-include (drop samples whose own timestamp is inside the window but whose flush instant is outside).
- The web dashboard's "fetch by visible window" will be jittery near edges.

Two acceptable options:
1. **Document** that the API filters by flush batch, not sample timestamp, and the client must clip on the returned `timestamp` field. (Cheap, but the API contract is fuzzy.)
2. **Filter twice**: query by overlapping `flushedAt` (loose), then post-filter `samples` in memory by each element's own `timestamp` field. Slightly more work but produces an exact window.

At minimum, decide and call it out explicitly in the plan.

### 4. No upper bound on response size

`rows.flatMap((row) => row.samples ?? [])` can produce arbitrarily large arrays for a long session — for biometrics this can be many thousands of points per minute. The plan should either:
- enforce a max window (reject `to - from > N`),
- or document an implicit cap (`take` on the batch query),
- or paginate.

The dashboard is the only consumer today, but unbounded JSON arrays bound to the request thread are an easy DoS vector. Recommend at minimum a `take` cap on `bioSampleRepo.find` and a clear error when results would be truncated.

### 5. Renaming `repo` → `moduleSessionRepo` is mentioned only in Task 3

Task 3 says: "rename the existing `repo` field to `moduleSessionRepo` for clarity now that the service owns multiple repos, and update all references inside `listRuns`." That's correct, but Task 4 then says "Inject `@InjectRepository(BioSessionSample) bioSampleRepo: Repository<BioSessionSample>` alongside the renamed `moduleSessionRepo`." Make sure the implementor doesn't add `bioSampleRepo` while forgetting to actually do the rename in the constructor — make Task 3 explicit that the constructor signature changes too.

### 6. Sort stability after flatten

`order: { flushedAt: 'ASC' }` sorts rows, but the flattened sample array is then implicitly ordered by flush instant, not by per-sample `timestamp`. Two batches whose `flushedAt` are close but whose internal samples interleave by `timestamp` will appear interleaved-incorrectly. If the dashboard consumes the array directly for a chart, it should either re-sort by `timestamp` on the client, or the service should sort after flattening. Worth a one-line decision in the plan.

### 7. `JwtPayload` import path consistency

Task 5/7 reuses the controller's existing `JwtPayload` import — fine. Just confirm `Param`, `ParseUUIDPipe`, and (if not already) `Query` are added to the `@nestjs/common` import; the plan mentions `Param` and `ParseUUIDPipe` but `Query` is already imported in the current controller.

## Positive Notes

- Reuse of `ModuleSession` registration pattern across modules matches the existing intentional design and avoids touching `RealtimeModule`. The plan correctly flags this.
- Centralizing `assertSessionOwnership` as a private helper is the right call — both endpoints share identical access control.
- `TimeRangeQueryDto` with `@IsOptional() + @IsISO8601()` is correct given the global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` in `main.ts`.
- No migrations needed — both target entities (`BioSessionSample`, `SessionStreamSample`) and tables already exist.
- Plan correctly notes that the class-level `@UseGuards(JwtAuthGuard)` covers the new routes; no per-route guard noise.

## Required Changes Before Implementation

1. **Fix the argument-order bug in Tasks 5 and 7.** Strongly recommend changing service signatures to `(userId, sessionId, from?, to?)` to match `listRuns(userId, ...)` and updating all internal references accordingly (`assertSessionOwnership(userId, sessionId)`, `where: { id: sessionId }`, etc.).
2. **Pick a single inclusivity convention** for the time-window filter and apply it to all three branches (both, only-from, only-to).
3. **Decide whether to filter by `flushedAt` or by per-sample `timestamp`** and document it in the plan.
4. **Add an upper bound** on the number of rows / flattened samples returned, or document the explicit cap and behavior on overflow.
5. **Make the `repo` → `moduleSessionRepo` rename explicit** in Task 3 by mentioning the constructor signature change.

Once these are addressed the plan is implementable.
