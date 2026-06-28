# Analytics read tolerant of bio on root-or-child (windowed)

**Date:** 2026-06-28
**Source:** conversation context

## Key Findings

- The analytics read path currently joins bio strictly by `moduleSessionId = sessionId` (the activity). This must become tolerant: read bio from the activity's own id **or** from its `rootSessionId` sliced by the activity's time window.
- Deploying the tolerant read **before** flipping bio ingest to the root ([[10-bio-ingest-to-root]]) is the trick that keeps every step non-breaking: old sessions (bio on child, `rootSessionId` null) behave exactly as today; new root-bound bio is found via the root branch once ingest flips. No dashboard gap.

## Details

### Current state — `src/sessions/sessions.service.ts`
- `assertSessionOwnership` (`sessions.service.ts:121-135`) does `moduleSessionRepo.findOne({ where: { id: sessionId } })` and returns the full `ModuleSession`. After [[02-root-session-schema]] adds the `rootSessionId` column, `session.rootSessionId`, `session.startedAt`, and `session.endedAt` are all available on the returned entity. **Both** `listBiometrics` and `aggregateBiometrics` already receive this entity: `listBiometrics` calls `assertSessionOwnership` at `sessions.service.ts:156` and passes the resolved `session` to `aggregateBiometrics` at `:161-167`. The raw path currently filters by `sessionId` (a string param), not by `session.id` — switch it to the entity's id set (see below).
- `listBiometrics` raw path filters by `moduleSessionId: sessionId` at `sessions.service.ts:176-178`, then trims each sample by per-sample `timestamp` against optional `from`/`to` at `:219-220`.
- `aggregateBiometrics` SQL path filters by `b."moduleSessionId" = ${sessionParam}` where `sessionParam = p(session.id)` (`sessions.service.ts:267` builds the param, `:276` uses it in the `conditions` array).
- `listInstructions` (`sessions.service.ts:352-423`) filters `session_stream_samples` by `moduleSessionId: sessionId` at `:365-367` — **UNCHANGED** by this task. Instructions stay strictly per-child (confirmed: do not add the id-set or default-window logic here).

### Inlined contracts (this note is self-contained — do not open other notes)
The `ModuleSession` entity (`src/realtime/entities/module-session.entity.ts`) returned by `assertSessionOwnership` exposes the fields this note's code reads:
- **`id: string`** — the uuid primary key (`@PrimaryGeneratedColumn('uuid')`).
- **`rootSessionId: string | null`** — nullable uuid column (`@Column({ type: 'uuid', nullable: true })`); `null` for legacy/un-migrated sessions. Added to the entity by the root-session schema task; if absent when this task runs, that schema task must land first.
- **`startedAt: Date`** — non-null session start (`@Column()`).
- **`endedAt?: Date`** — nullable session end (`@Column({ nullable: true })`); `undefined`/`null` for an in-flight session.

### Change — bio reads only

**Resolve the id set (both paths).** After `assertSessionOwnership`, build:
```ts
const bioSessionIds =
  session.rootSessionId != null
    ? [session.id, session.rootSessionId]
    : [session.id];
```
Order does not matter (used in `In(...)` / `ANY(...)`); `session.id` first is fine. The set is exactly 1 or 2 ids — never includes a null.

**Default window rule (both paths).** When the request `from`/`to` are absent, default the per-sample window to the session's own interval:
- `from` absent → `fromMs = session.startedAt.getTime()`
- `to` absent → `toMs = session.endedAt?.getTime()` (when `endedAt` is null — an in-flight session, see `:118-120`) leave `toMs` undefined so the upper bound stays open and live samples are still returned.

This default applies to the **per-sample timestamp** filter only (raw path `:219-220`; SQL path `:298-303`). Leave the coarse `flushedAt` filter logic (`:182-193`, `:284-295`) keyed off the **original** `fromDate`/`toDate` request values: when the caller omits `from`/`to`, the coarse `flushedAt` filter must NOT fire (so it fetches all of the root's batches and the per-sample default window does the exact trim). Concretely: introduce the default only into the `fromMs`/`toMs` used by the per-sample comparisons, not into the `fromDate`/`toDate` used by the `flushedAt` branches.

**Raw path (`listBiometrics`, `sessions.service.ts:176-178`).** Change:
```ts
const where: FindOptionsWhere<BioSessionSample> = { moduleSessionId: sessionId };
```
to:
```ts
const where: FindOptionsWhere<BioSessionSample> = { moduleSessionId: In(bioSessionIds) };
```
Add `In` to the existing `typeorm` import (`sessions.service.ts:10-16` already imports `And, FindOptionsWhere, LessThan, MoreThanOrEqual, Repository`). Keep `order: { flushedAt: 'ASC' }`, `take: ROW_CAP` (`:197-198`) and the `rows.length === ROW_CAP` 413 guard (`:201-205`) unchanged.

**SQL path (`aggregateBiometrics`, `sessions.service.ts:267,276`).** Currently:
```ts
const sessionParam = p(session.id);            // :267
...
`b."moduleSessionId" = ${sessionParam}`,       // :276 (first entry in conditions[])
```
Change to bind the id array and use `= ANY(...)`:
```ts
const sessionIdsParam = p(bioSessionIds);      // pg array param
...
`b."moduleSessionId" = ANY(${sessionIdsParam})`,
```
The `bioSampleRepo.query(sql, params)` call (`:338-341`) passes a `uuid[]` JS array as one bind param — node-postgres serializes it to a Postgres array, so `= ANY($n)` matches. All other conditions (`:277-280` — `jsonb_typeof` checks and the `> garbageBoundParam` filter) and `GARBAGE_TS_SLACK_MS` (`:44`, `:268-270`) stay identical.

### Boundary inclusivity (pinned from current code — DO NOT CHANGE)
The per-sample window is **half-open `[from, to)`: include `from`, exclude `to`.**
- Raw path: `if (fromMs !== undefined && ts < fromMs) continue;` (`sessions.service.ts:219`) and `if (toMs !== undefined && ts >= toMs) continue;` (`:220`).
- SQL path: `(elem->>'timestamp')::numeric >= ${p(fromMs)}` (`:299`) and `(elem->>'timestamp')::numeric < ${p(toMs)}` (`:302`).
- Confirmed identical in `biometric-aggregation.util.ts:429-430` (`collectRawPoints`) and `:547-548` (`aggregateRawSamples`), and documented as the invariant at `:6` and `:50-52` (`bucketIndexForMs`). The bucket floor expr `floor((elem->>'timestamp')::numeric / ${bucketMsParam})` (`sessions.service.ts:313`) is epoch-0 anchored and in lockstep with `bucketIndexForMs` (`biometric-aggregation.util.ts:50-52`) — unchanged by this task.

### Guards / gotchas
- Defaulting the window to `[session.startedAt, session.endedAt)` is what makes overlapping activities each return their own slice of one shared root bio stream — without it a child would return the entire root timeline. The default never widens an explicit caller window; it only fills an omitted bound.
- For old data (`rootSessionId` null) the id set is exactly `[session.id]` (one element) and the per-sample default is the session's own interval → the `In([id])` query and the trim are byte-identical to today's `moduleSessionId = sessionId` path. The legacy path stays unchanged in behavior.
- No double counting: bio lives on exactly one row-owner (child today, root after [[11-migration-backfill-roots]]), never both. The id set is the union, but only one of the two ids actually owns rows for any given era.
- Keep the existing 413 (`PayloadTooLargeException`) guards: `ROW_CAP = 60_000` (`:23`, raw `take` + `:201-205`), `FLAT_CAP = 50_000` (`:24`, `:222-226`), `LTTB_POINTS_ROW_CAP = 3_000_000` (`:33`, `:343-347`). All unchanged.
- Keep the coarse `flushedAt` filter + `FLUSHED_AT_PAD_MS = 120_000` (`:39`, raw `:182-193`, SQL `:284-295`) unchanged — but driven by the original request `fromDate`/`toDate`, NOT the defaulted window (see Change above).

### Verify
Verification is **manual** — no automated test (the test task was dropped). Exercise these against the dashboard with a prod snapshot restored onto dev:
- Old session (`rootSessionId` null) bio still returned identically — `In([id])` + own-interval default = today's behavior.
- A session whose bio sits on its root returns only the windowed slice (`In([id, rootId])` matches root rows, per-sample default trims to `[startedAt, endedAt)`).
- Two overlapping children of one root each return their own window of the same bio rows.
- In-flight session (`endedAt` null) with no `to` param still returns live samples (upper bound stays open).

## Open Questions
- None — depends only on the `rootSessionId` column from [[02-root-session-schema]] (must be merged first so `session.rootSessionId` exists on the entity).

## Test reconciliation (committed tests)

**NO automated test** — verification is manual (§Verify; the test task was dropped). No committed `describe/it` case exercises `listBiometrics`/`aggregateBiometrics` for the tolerant read, so nothing flips RED→GREEN and there is nothing to invert or delete.

The tolerant-read contract is internally complete and self-consistent:
- **Id set:** `In([session.id, session.rootSessionId])` when `rootSessionId != null`, else `In([session.id])` (raw path); `= ANY($n)` with the same array (SQL path). Never includes a null (§Change).
- **Window:** half-open `[startedAt, endedAt)` defaulted onto the per-sample timestamp filter only when the caller omits `from`/`to`; `endedAt` null → open upper bound. The coarse `flushedAt` filter stays driven by the original request `fromDate`/`toDate`, not the defaulted window — this separation is load-bearing and complete.
- **No double counting:** bio owns exactly one row-owner per era (child pre-migration, root post-[[11-migration-backfill-roots]]); the union id-set only ever matches one.

Depends only on note [[02-root-session-schema]] (the `rootSessionId`/`startedAt`/`endedAt` fields on the entity). No forward-coupling gap. Confirmed complete.
