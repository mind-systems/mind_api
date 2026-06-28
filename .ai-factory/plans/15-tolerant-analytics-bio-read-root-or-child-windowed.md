# Plan: Tolerant analytics bio read (root-or-child, windowed)

## Context
Make `SessionsService` bio reads resolve samples from the activity's own id **or** its `rootSessionId`, sliced to the activity's own time window, so a child returns only its interval of the shared root bio timeline. This deploys before the ingest flip and stays non-breaking: legacy child-bio (`rootSessionId` null) reads byte-identically to today, while future root-bound bio is found via the root branch.

## Settings
- Testing: no (verification is manual on a prod snapshot — the test task was dropped)
- Logging: minimal (no new logs needed)
- Docs: no

## Tasks

### Phase 1: Tolerant bio read

- [x] **Task 1: Add `In` import and resolve the bio id set**
  Files: `src/sessions/sessions.service.ts`
  Add `In` to the existing `typeorm` import (currently `And, FindOptionsWhere, LessThan, MoreThanOrEqual, Repository` — see import block around lines 10-16).
  In `listBiometrics`, immediately after `const session = await this.assertSessionOwnership(userId, sessionId);` (~line 168), build the id set once:
  ```ts
  const bioSessionIds =
    session.rootSessionId != null
      ? [session.id, session.rootSessionId]
      : [session.id];
  ```
  Pass `bioSessionIds` into `aggregateBiometrics` as a new argument (extend its signature) so the SQL path uses the same set — or rebuild the identical set inside `aggregateBiometrics` from the `session` it already receives. Prefer threading `bioSessionIds` through to keep a single source of truth. The set is always 1 or 2 ids and never contains a null.

- [x] **Task 2: Raw path — read by id set + default per-sample window** (depends on Task 1)
  Files: `src/sessions/sessions.service.ts`
  In `listBiometrics` raw path (~lines 188-190), change the `where` filter from `{ moduleSessionId: sessionId }` to `{ moduleSessionId: In(bioSessionIds) }`.
  Default the **per-sample** window (`fromMs`/`toMs` used at the `if (fromMs !== undefined && ts < fromMs) continue;` / `if (toMs !== undefined && ts >= toMs) continue;` checks, ~lines 231-232) when the caller omits a bound:
  - `from` absent → `fromMs = session.startedAt.getTime()`
  - `to` absent → `toMs = session.endedAt?.getTime()` (leave `undefined` when `endedAt` is null so an in-flight session keeps an open upper bound and live samples are still returned).
  Keep the coarse `flushedAt` filter branches (~lines 194-205) driven by the **original** request `fromDate`/`toDate` — do NOT feed the defaulted window into them (when the caller omits `from`/`to`, the coarse filter must not fire so all root batches are fetched and the per-sample default does the exact trim). Keep `order: { flushedAt: 'ASC' }`, `take: ROW_CAP`, the `rows.length === ROW_CAP` 413 guard, and the `FLAT_CAP` 413 guard unchanged.
  Boundary inclusivity stays half-open `[from, to)` — do not change the `<`/`>=` comparisons.

- [x] **Task 3: SQL path — bind id array with `= ANY(...)` + default per-sample window** (depends on Task 1)
  Files: `src/sessions/sessions.service.ts`
  In `aggregateBiometrics`, replace `const sessionParam = p(session.id);` (~line 279) with an array bind, e.g. `const sessionIdsParam = p(bioSessionIds);`, and change the first `conditions[]` entry from `` `b."moduleSessionId" = ${sessionParam}` `` (~line 288) to `` `b."moduleSessionId" = ANY(${sessionIdsParam})` ``. node-postgres serializes the JS `uuid[]` to a Postgres array for the existing `bioSampleRepo.query(sql, params)` call (~lines 350-353), so `= ANY($n)` matches.
  Apply the same per-sample window default as Task 2 to the `fromMs`/`toMs` used by the per-sample filter (~lines 310-314): `from` absent → `session.startedAt.getTime()`; `to` absent → `session.endedAt?.getTime()` (undefined when `endedAt` null). Keep the coarse `flushedAt` conditions (~lines 296-307) driven by the original request `fromDate`/`toDate`. Leave the `jsonb_typeof` checks, `garbageBoundParam` / `GARBAGE_TS_SLACK_MS` filter, the epoch-0 `floor((elem->>'timestamp')::numeric / bucketMs)` bucket expression, `LTTB_POINTS_ROW_CAP` cap + 413 guard, and the half-open `>=`/`<` boundaries unchanged.

- [x] **Task 4: Confirm `listInstructions` is untouched** (depends on Task 3)
  Files: `src/sessions/sessions.service.ts`
  Verify `listInstructions` (~line 364) still filters `session_stream_samples` by `moduleSessionId: sessionId` only — instructions stay strictly per-child. Do NOT apply the id-set or default-window logic here. This is a guard check, no code change expected.

## Notes for the implementer
- This is the read half of a two-step non-breaking rollout; the ingest flip (Phase 58, next task) and the backfill migration land separately. Do not change ingest or schema here.
- No double counting: bio owns exactly one row-owner per era (child today, root after the backfill), so the union id-set only ever matches one of the two ids.
- The window default never widens an explicit caller window — it only fills an omitted bound.
- Manual verification (prod snapshot on dev): (1) old `rootSessionId`-null session returns bio identically; (2) a session whose bio sits on its root returns only its windowed slice; (3) two overlapping children of one root each return their own window of the shared rows; (4) in-flight session (`endedAt` null) with no `to` still returns live samples.

(Single commit — fewer than 5 substantive code tasks. Suggested message: "Read bio tolerant of root-or-child with windowed slice")
