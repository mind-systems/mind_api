# Code Review: SessionsModule + GET /sessions/runs (iteration 1)

**Plan reviewed:** `.ai-factory/plans/27-sessionsmodule-get-sessions-runs.md`
**Changes reviewed:** `src/app.module.ts`, `src/sessions/dto/list-runs-query.dto.ts`, `src/sessions/sessions.controller.ts`, `src/sessions/sessions.module.ts`, `src/sessions/sessions.service.ts`

## Summary

The implementation matches the plan exactly and is small, focused, and low-risk. No new entity, no migration, no changes to `RealtimeModule`. The `flatMap`-based narrowing avoids the `!` operator and resolves the `continue`-in-`map` wording issue raised in plan-review-1. The global `ValidationPipe` in `src/main.ts:79-85` is configured with `transform: true`, so `@Type(() => Number)` will coerce query strings to numbers correctly. The migration at `src/migrations/1774863293946-InitialSchema.ts:259-282` already provisions `module_sessions` with an index on `userId`, so the planned `WHERE userId = ?` query path is supported.

No correctness, security, or runtime-failure defects were identified. A few small, optional observations are listed below.

## Verified

| Claim | Evidence |
|---|---|
| `ModuleSession` is the right entity, owned by `RealtimeModule` | `src/realtime/entities/module-session.entity.ts:11-49` |
| `module_sessions` table exists with `userId` index and nullable `endedAt` TIMESTAMP | `src/migrations/1774863293946-InitialSchema.ts:259-282` |
| `JwtAuthGuard` exported from `AuthModule` | `src/users/auth.module.ts:56` |
| `JwtAuthGuard` populates `request.user` with the JWT payload (sub = user id) | `src/users/guards/jwt-auth.guard.ts:44` |
| `CurrentUser` decorator returns `JwtPayload` from the HTTP request | `src/users/decorators/current-user.decorator.ts` |
| Global `ValidationPipe` runs with `transform: true`, `whitelist: true`, `forbidNonWhitelisted: true` | `src/main.ts:79-85` |
| `SessionsModule` registered in `AppModule.imports` after `SyncModule` per plan ordering | `src/app.module.ts:43` |
| `findAndCount({ where: { userId, endedAt: Not(IsNull()) }, order: { startedAt: 'DESC' }, take, skip })` matches the spec | `src/sessions/sessions.service.ts:30-35` |
| `Math.min(limit ?? 50, 200)` enforces the server-side cap | `src/sessions/sessions.service.ts:27` |
| `durationSeconds = Math.round((endedAt - startedAt) / 1000)` matches the spec | `src/sessions/sessions.service.ts:41-43` |
| `import type { JwtPayload }` avoids unnecessary runtime side-effects | `src/sessions/sessions.controller.ts:4` |
| No `!` non-null assertions anywhere in the new code | grep-clean |
| No logging added (per `.ai-factory/RULES.md` and plan "Logging: minimal") | grep-clean |

## Findings

### Minor 1 — Pagination is order-unstable when `startedAt` collides

`findAndCount({ ..., order: { startedAt: 'DESC' } })` has no tiebreaker. If two `module_sessions` rows for the same user happen to share the exact `startedAt` value (`TIMESTAMP` without time zone, no fractional-second guarantee from session-start callsites), PostgreSQL is free to return them in any order, and a client paginating with `limit=50` could either see a row twice or miss one across page boundaries.

In practice, two sessions starting in the same microsecond for the same user is extremely unlikely (a user does not start two activity sessions concurrently), so this is not a real-world correctness bug for the current product. It is worth noting because the same pattern will be inherited by Milestone 4's `/sessions/runs/:id/biometrics` and the rest of the dashboard pagination.

Recommended (optional) fix when revisiting Milestone 4:

```ts
order: { startedAt: 'DESC', id: 'DESC' },
```

No action required for this iteration.

### Minor 2 — `if (!row.endedAt) return []` inside `flatMap` is unreachable

`src/sessions/sessions.service.ts:38-46`:

```ts
const items = rows.flatMap((row) => {
  if (!row.endedAt) {
    return [];
  }
  ...
});
```

The TypeORM filter `endedAt: Not(IsNull())` guarantees `row.endedAt` is non-null on every returned row, so this branch can never be exercised at runtime. The guard exists only to narrow `endedAt?: Date` to `Date` for TypeScript. This is correct and avoids the forbidden `!` operator — but it is dead-on-success defensive code that will silently drop rows if a future schema change ever makes `endedAt` re-appearable as null.

This is acceptable as-written. A loud-fail alternative would be more aligned with `.ai-factory/RULES.md` ("explicit checks fail loudly with a meaningful error"):

```ts
const items = rows.map((row) => {
  if (!row.endedAt) {
    throw new Error(
      `listRuns: module_session ${row.id} has null endedAt despite Not(IsNull()) filter`,
    );
  }
  ...
});
```

Either approach is fine; flagging only because the choice is a deliberate trade-off (silent drop vs. loud throw) and the plan listed both options. No action required.

### Minor 3 — CORS not addressed; out-of-band prerequisite for the dashboard

`src/main.ts:87-91` configures CORS as `origin: process.env.FRONTEND_URL || 'http://localhost:8000'` (single-origin string). The new `GET /sessions/runs` endpoint will be called cross-origin from the `mind_web` dashboard host; if `FRONTEND_URL` is not set per env to the dashboard's origin, the browser will block the response.

This was correctly flagged in the prior Milestone 2 plan (`26-...md` Notes section) as an out-of-band prerequisite and is not regressed by this change. No action required in this iteration — but worth carrying as a deployment checklist item for the dashboard launch.

### Minor 4 — `forbidNonWhitelisted: true` makes the endpoint reject unknown query params

Because of the global `forbidNonWhitelisted: true`, `GET /sessions/runs?limit=10&foo=bar` will respond `400 Bad Request` rather than ignoring `foo`. This is consistent with the rest of the codebase and almost certainly desired API hygiene — calling it out only so the `mind_web` integrator does not get surprised by a 400 from a stray query parameter.

No action required.

### Positive

- The `import type { JwtPayload }` keeps the bundle clean by not introducing a runtime dep on the interface module.
- `take`/`skip` defaults are applied in the service (`limit ?? 50`, `offset ?? 0`) rather than via a custom DTO decorator — keeps the DTO declarative.
- `Math.min(limit ?? 50, 200)` enforces the cap even when the client passes `?limit=10000`, preventing accidental large responses.
- The module's intent comment (`src/sessions/sessions.module.ts:4-7`) correctly documents the deliberate exception to the "entities stay in their owning module" rule, so future maintainers will not "fix" the dual `forFeature` registration.
- The same `SessionsModule` is shaped to absorb Milestone 4 (`GET /sessions/runs/:id/biometrics|instructions`) by adding two entities to its `forFeature` list — no rework needed at that point.
- No logs of user id, JWT, or session contents anywhere in the new code (`.ai-factory/RULES.md` compliant).
- `import type` placement preserves NestJS DI behavior because `JwtPayload` is only used as a parameter annotation.

## Verdict

All four findings are minor/informational; none are runtime or security defects. The implementation is correct, in-scope, and matches the plan and architectural rules.

REVIEW_PASS
