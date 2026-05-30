# Plan Review: SessionsModule + GET /sessions/runs (iteration 1)

**Plan reviewed:** `.ai-factory/plans/27-sessionsmodule-get-sessions-runs.md`
**Risk level:** 🟢 Low

## Summary

The plan is tightly scoped, architecturally sound, and directly traces back to Milestone 3 in `.ai-factory/notes/10-web-dashboard-rest-api-spec.md` and Phase 21 of `ROADMAP.md`. All claimed file paths, decorators, exports, and imports were verified against the codebase. No new migration is needed — `module_sessions` already exists and is indexed on `userId`. Only one minor implementation-detail correction is needed; everything else passes.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)** — PASS. The plan declares the same-entity-in-two-modules pattern as a deliberate exception and instructs the implementer to comment it in the module file. This matches the spirit of "entities stay in their module" while documenting the read-only-consumer carve-out for `RealtimeModule` ↔ `SessionsModule`. Controller is thin; service holds the query; `JwtAuthGuard` is applied at the controller boundary. Module dependency graph stays acyclic: `SessionsModule → AuthModule`.
- **Rules (`.ai-factory/RULES.md`)** — PASS. Plan explicitly forbids `!` on `endedAt` and prescribes an explicit narrowing check; no sensitive data logged (no logging at all in success path); no entry/exit logs.
- **Roadmap (`.ai-factory/ROADMAP.md`)** — PASS. Plan corresponds 1:1 to the unchecked Phase 21 bullet "`SessionsModule` + `GET /sessions/runs`". Subsequent Phase 21 bullets (Milestones 4 and 5) extend this module — the plan correctly avoids exporting anything from `SessionsModule` because no other module depends on it yet.

## Verified Against Codebase

| Plan claim | Verification |
|---|---|
| `ModuleSession` entity lives at `src/realtime/entities/module-session.entity.ts` with `@Index(['userId'])` and `endedAt?: Date` nullable | ✅ Confirmed (lines 11–14, 38–39) |
| `JwtAuthGuard` exported from `AuthModule` | ✅ Confirmed in `src/users/auth.module.ts:56` |
| `CurrentUser` decorator returns `JwtPayload` from `src/users/decorators/current-user.decorator.ts` | ✅ Confirmed |
| `JwtPayload` interface has `sub: string` | ✅ Confirmed in `src/users/interfaces/auth.interface.ts:2-6` |
| `ValidationPipe` is globally registered with `transform: true` | ✅ Confirmed in `src/main.ts:79-85` — so `@Type(() => Number)` in the DTO will be honored |
| `AppModule.imports` ordering convention with `SyncModule` last | ✅ Confirmed in `src/app.module.ts:18-42` |
| Target directory `src/sessions/` does not yet exist | ✅ Confirmed (glob returned no files) |

## Findings

### Minor — `continue` inside `.map()` will not work as written

Task 2 (Phase 1) instructs:

> add a narrowing check inside the map (`if (!row.endedAt) continue;` or `if (!row.endedAt) throw new Error('unexpected null endedAt');`)

`Array.prototype.map` is not a loop with `continue` semantics; `continue` is only valid inside `for`/`while`. If the implementer literally writes `.map(row => { if (!row.endedAt) continue; ... })`, TypeScript will reject it with `SyntaxError: Illegal continue statement`.

Recommended phrasing (any of the following is fine):

```ts
// Option A — throw on impossible state (TypeORM filter guarantees non-null)
const items = rows.map((row) => {
  if (!row.endedAt) {
    throw new Error('Module session is missing endedAt despite Not(IsNull()) filter');
  }
  return {
    id: row.id,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSeconds: Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000),
  };
});

// Option B — filter first, then map (no impossible-state error)
const items = rows
  .filter((row): row is ModuleSession & { endedAt: Date } => row.endedAt != null)
  .map((row) => ({ ... }));
```

Either approach narrows `endedAt` without using `!`. Update Task 2 wording so the implementer doesn't reach for `continue` and then fall back to `!` when the compiler complains.

### Minor — `JwtPayload.sub` is documented as user id, but worth a one-line assertion

`JwtPayload` only declares `sub: string` without semantic comment. The plan correctly states `JwtPayload.sub` is the user id, which matches usage in other controllers (e.g. realtime). No action required — just confirming the assumption holds.

### Positive Notes

- Explicit cap on `take` with `Math.min(limit ?? 50, 200)` is enforced server-side, matching the spec and preventing a client from blowing up the response.
- Defaults are applied in the service rather than via custom DTO decorators — keeps the DTO declarative and aligned with class-validator idioms.
- The plan pre-emptively flags the `Math.min('200', 200)` foot-gun and ties it to the `ValidationPipe.transform: true` sanity check in `main.ts`. That check passes.
- The plan refuses to modify `RealtimeModule`, which keeps the streaming module's responsibilities clean.
- Task ordering (DTO → service → controller → module → AppModule registration) matches the natural compile-order; no forward references.
- Plan correctly notes that re-registering `ModuleSession` via `TypeOrmModule.forFeature` in a second module is supported by TypeORM and produces a per-DI-scope repository — no need to re-export from `RealtimeModule`.
- No new env var, no migration, no proto change — scope is appropriately narrow for a Milestone-3 thin REST layer.

## Verdict

One small wording fix in Task 2 (replace `continue` with `throw` or filter-then-map). Everything else is implementable as written.

PLAN_REVIEW_PASS
