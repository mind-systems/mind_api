# Enrich `GET /sessions/runs` with activityType + breath meta (web dashboard)

**Date:** 2026-05-31
**Source:** conversation context — mind_web dashboard requirement

## Key Findings

- The web dashboard cannot distinguish breath sessions from meditation sessions, because `GET /sessions/runs` returns only `{ id, startedAt, endedAt, durationSeconds }` — `activityType` is dropped even though it lives on the `ModuleSession` entity.
- The web session list also looks bare (date + duration only). The dashboard wants to enrich each row with the session's name and difficulty, which for breath sessions live on the joined `breath_sessions` row.
- **One additive change is needed:** add three fields to each item of `GET /sessions/runs`. No new endpoint, no schema change, no change to the biometrics/instructions endpoints, no change to the gRPC path.

## Details

### Endpoint

`GET /sessions/runs?limit=&offset=` — implemented in `SessionsService.listRuns` (`src/sessions/sessions.service.ts`), controller `src/sessions/sessions.controller.ts`. Spec origin: `notes/10-web-dashboard-rest-api-spec.md` (Milestone 3).

### Current item shape

```ts
{ id: string; startedAt: Date; endedAt: Date; durationSeconds: number }
```

### Required item shape (add 3 fields)

```ts
{
  id: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  activityType: 'breath' | 'meditation';   // from ModuleSession.activityType (already persisted)
  description: string | null;               // breath only: breath_sessions.description; null otherwise
  complexity: number | null;                // breath only: breath_sessions.complexity; null otherwise
}
```

Field semantics:

- **`activityType`** — pass through `ModuleSession.activityType` verbatim (`ActivityType` enum, values `'breath'` / `'meditation'` — see `src/realtime/enums/activity-type.enum.ts`). Already on the entity; just include it in the projection.
- **`description`** — the human-readable session name. For breath sessions it is `breath_sessions.description` (joined via `ModuleSession.activityRefId`). For meditation sessions, or when the referenced breath row is missing/soft-deleted, return `null`. The web supplies its own fallback label.
- **`complexity`** — breath difficulty (`breath_sessions.complexity`, a float, default `0`). `null` for meditation or when the breath row is missing/soft-deleted.

### The join

`ModuleSession` has **no `@ManyToOne`** to `BreathSession` (decoupled at the ORM level by design — see the comment in `module-session.entity.ts`). Use an explicit `leftJoin` on the raw table inside the existing `listRuns` query. Resolve `complexity`/`description` in a **single query** — do **not** do a per-row `SELECT ... WHERE id = $1` lookup. (Note: `stats.service.ts:101-103` does exactly that per-row lookup in a loop; that N+1 pattern is fine for the once-a-day stats aggregation but must not be copied here, where a page can be up to 200 rows.)

Join condition:

```
LEFT JOIN breath_sessions bs
       ON bs.id = module_sessions."activityRefId"
      AND module_sessions."activityType" = 'breath'
      AND bs."deletedAt" IS NULL
```

The `activityType = 'breath'` guard in the join keeps a meditation session's `activityRefId` (which points at a meditation/pose config, not a breath row — see `notes/11-activity-type-meditation-extension.md`) from ever matching a breath row by coincidence.

Suggested TypeORM implementation (replace the current `findAndCount` in `listRuns`):

```ts
const take = Math.min(limit ?? 50, 200);
const skip = offset ?? 0;

const qb = this.moduleSessionRepo
  .createQueryBuilder('ms')
  .leftJoin(
    'breath_sessions',
    'bs',
    'bs.id = ms."activityRefId" AND ms."activityType" = :breath AND bs."deletedAt" IS NULL',
    { breath: ActivityType.BREATH },
  )
  .where('ms.userId = :userId', { userId })
  .andWhere('ms.endedAt IS NOT NULL')
  .orderBy('ms.startedAt', 'DESC')
  .select(['ms.id', 'ms.startedAt', 'ms.endedAt', 'ms.activityType'])
  .addSelect('bs.description', 'bs_description')
  .addSelect('bs.complexity', 'bs_complexity')
  .take(take)
  .skip(skip);

const total = await qb.getCount();
const { entities, raw } = await qb.getRawAndEntities();

const items = entities.map((ms, i) => {
  const r = raw[i];
  const rawComplexity = r.bs_complexity;
  return {
    id: ms.id,
    startedAt: ms.startedAt,
    endedAt: ms.endedAt!,
    durationSeconds: Math.round((ms.endedAt!.getTime() - ms.startedAt.getTime()) / 1000),
    activityType: ms.activityType,
    description: r.bs_description ?? null,
    complexity: rawComplexity != null ? Number(rawComplexity) : null,
  };
});

return { items, total };
```

Notes on the mapping:
- `getRawAndEntities()` keeps `entities` and `raw` index-aligned, so `raw[i]` is the joined row for `entities[i]`.
- Postgres returns `numeric`/`float` raw columns as strings — coerce `complexity` with `Number(...)`, guarding `null`.
- `getCount()` ignores the `take`/`skip` and counts the filtered set — same `total` semantics as the current `findAndCount`.

### Invariants preserved (do not change)

- Filter `userId = <current user>` AND `endedAt IS NOT NULL` (completed sessions only).
- Order `startedAt DESC`.
- Pagination `limit` (capped at 200) / `offset`; response shape `{ items, total }`.
- The biometrics and instructions endpoints are untouched.

### Backward compatibility

Purely additive — existing fields keep their names and types. The gRPC surface is not involved (this is the REST `listRuns` projection only). No migration: `activityType` is already a column; `breath_sessions.description`/`complexity` already exist.

### Before / after

```jsonc
// before
{ "items": [
  { "id": "…", "startedAt": "2026-05-30T14:05:00Z", "endedAt": "2026-05-30T14:12:32Z", "durationSeconds": 452 }
], "total": 1 }

// after
{ "items": [
  { "id": "…", "startedAt": "2026-05-30T14:05:00Z", "endedAt": "2026-05-30T14:12:32Z", "durationSeconds": 452,
    "activityType": "breath", "description": "Box breathing 4-4-4-4", "complexity": 3.2 },
  { "id": "…", "startedAt": "2026-05-30T08:00:00Z", "endedAt": "2026-05-30T08:10:00Z", "durationSeconds": 600,
    "activityType": "meditation", "description": null, "complexity": null }
], "total": 2 }
```

### Why the web needs this

- **Distinguish modules:** the list must label each session, and the detail panel renders differently per module — meditation sessions have no `breath_phase` instructions (`notes/11`), so the web omits the breath-phase track for them. Without `activityType` the web cannot make that decision.
- **Enrich the cell:** the session row currently shows only date + duration. `description` (name) and `complexity` (difficulty) fill it out so it isn't bare.
