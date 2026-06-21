# Plan: Biometric LOD aggregated read — on-the-fly aggregation + contract

## Context
Add an optional `?bucketSec=<n>` to `GET /sessions/runs/:id/biometrics` that returns a spike-preserving per-bucket min/max envelope, computed on the fly (Postgres `jsonb_array_elements` + `jsonb_each` over numeric leaves) with no new table, write path, cache, or migration. Omitting `bucketSec` keeps today's raw byte-for-byte behavior.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Contract

- [x] **Task 1: Add optional `bucketSec` query param**
  Files: `src/sessions/dto/time-range-query.dto.ts`, `src/sessions/sessions.controller.ts`
  Extend `TimeRangeQueryDto` with an optional `bucketSec?: number`. Decorate it `@IsOptional()`, `@Type(() => Number)`, `@IsInt()`, `@Min(1)` (reject `0`/negative/fractional/`abc`→NaN). Add the `@Type` import from `class-transformer` — the current DTO imports only from `class-validator`. Coercion is safe because `main.ts` sets `transform: true` on the global `ValidationPipe`, so the query string is converted to a number before `@IsInt()`/`@Min(1)` run. Keep existing `from`/`to` untouched. In `SessionsController.listBiometrics`, pass `query.bucketSec` through as a 5th argument to `sessionsService.listBiometrics(...)`. Do not change the `instructions` handler.

### Phase 2: On-the-fly aggregation

- [x] **Task 2: Implement the type-driven bucket aggregation query** (depends on Task 1)
  Files: `src/sessions/sessions.service.ts`
  Add a private method `aggregateBiometrics(session: ModuleSession, bucketSec: number, from?: string, to?: string)` returning `Record<string, unknown>[]`. Implement it as a single parameterized raw SQL query via `this.bioSampleRepo.query(sql, params)` (follow the existing `repository.query`/`manager.query` parameterized-`$n` pattern used in `changelog.service.ts:57-60` and `stats.service.ts` — quoted camelCase column names, values passed as a params array, never string-interpolated).
  - **Session scoping (must-fix — security blocker).** The `WHERE` clause **must begin with** `b."moduleSessionId" = $1` (parameterized; `sessionId` passed as the **first** param, with all remaining `$n` placeholders renumbered accordingly). Without it the query unnests `jsonb_array_elements` across **every session's rows for every user** — a cross-session data leak, wrong aggregates, and a full-table scan that ignores the `@Index(['moduleSessionId'])`. `assertSessionOwnership` only validates ownership of `:id`; it does **not** constrain this query, so the SQL itself must scope by session id (mirrors the raw path's `where.moduleSessionId = sessionId` at `sessions.service.ts:145`). Use the quoted camelCase column name — this project has no snake-case naming strategy.
  - Unnest: `FROM bio_session_samples b, jsonb_array_elements(b.samples) AS elem, jsonb_each(elem->'data') AS kv`.
  - **Guard `data` shape before unnesting:** add `jsonb_typeof(elem->'data') = 'object'` to the predicate so a sample whose `data` is JSON `null` or a scalar does not make `jsonb_each` raise and fail the whole request (`data` is typed `unknown` and persisted verbatim; mirrors the raw path's defensiveness).
  - Schema-agnostic numeric filter: `jsonb_typeof(kv.value) = 'number'` (no hardcoded producer field names — a new numeric field is picked up automatically; non-numeric tags like `source`/booleans are dropped).
  - **Guard timestamp scalar before casting:** add `jsonb_typeof(elem->'timestamp') = 'number'` to the predicate. The raw path defensively skips non-`number` timestamps (`sessions.service.ts:179-186`, a guard from the Phase 32 Long `{low,high}` incident); without this guard a single non-scalar/non-numeric `timestamp` makes the unconditional `(elem->>'timestamp')::numeric` cast raise a SQL error and fail the **whole** request instead of skipping one sample.
  - Group key: `elem->>'sampleType'` as sample type, `kv.key` as field, and bucket index `floor((elem->>'timestamp')::numeric / (bucketSec*1000))`.
  - Aggregate `min` and `max` of the numeric leaf: cast jsonb number to numeric via `(kv.value #>> '{}')::numeric` (direct `jsonb::numeric` is not valid).
  - Window filter: reuse the coarse `flushedAt` bounds with `FLUSHED_AT_PAD_MS` padding (mirror the branching in the raw path) plus the exact per-sample bound `(elem->>'timestamp')::numeric >= fromMs` / `< toMs` when `from`/`to` are given, so the SQL trims to `[from, to)`.
  - Garbage-timestamp guard: add `(elem->>'timestamp')::numeric > $startedAtMs - GARBAGE_TS_SLACK_MS` (introduce a small slack constant, e.g. `60_000`) to drop stray `timestamp=0` samples that would otherwise create a phantom epoch-0 bucket. Use `session.startedAt.getTime()` for the bound (the owning `ModuleSession` is already loaded by `assertSessionOwnership`).
  - `GROUP BY` sample type, bucket, field; order in SQL is not required (final ordering done after reshape in Task 3).
  - The heavy unnest runs entirely in Postgres; only the small aggregated rowset returns to Node — so no `ROW_CAP`/`FLAT_CAP`/413 handling is needed on this path.

- [x] **Task 3: Reshape aggregated rows into synthetic min/max samples + branch `listBiometrics`** (depends on Task 2)
  Files: `src/sessions/sessions.service.ts`
  In `listBiometrics`, change the signature to accept `bucketSec?: number`. After `assertSessionOwnership` (capture the returned `ModuleSession`), branch: if `bucketSec === undefined`, run the existing raw path unchanged (back-compat, 413 guard intact); otherwise call `aggregateBiometrics(...)` and reshape its flat `(sampleType, bucket, field, min, max)` rows into `BioSampleDto`-shaped objects:
  - Group reshaped rows by `(sampleType, bucket)`. Per group emit **exactly 2** synthetic samples:
    - min-sample: `{ timestamp: bucketStart, sampleType, data: { <field> → bucketMin for every numeric field } }`
    - max-sample: `{ timestamp: bucketStart + bucketSec*500, sampleType, data: { <field> → bucketMax for every numeric field } }`
    where `bucketStart = bucket * bucketSec * 1000` (epoch ms) and `bucketSec*500` = bucket midpoint in ms. Distinct timestamps + fixed min-then-max order per bucket are required so the web's single min/max-envelope polyline does not degenerate to vertical segments.
  - **Convert pg text columns to `number` before arithmetic and before packing `data`.** `node-postgres` returns `min`, `max`, **and the `floor(...)` bucket index** as strings. Do `Number(row.bucket)` before computing `bucketStart` (relying on JS string→number coercion is a latent bug), and `Number(row.min)`/`Number(row.max)` when building `data`. Values stay well under `2^53` (epoch-ms ≈ 1.7e12).
  - Pack all numeric fields of the sample type into one synthetic sample each (field-wise extrema in one object is intended for an envelope). Omit non-numeric tags entirely.
  - Skip empty buckets implicitly — only buckets present in the SQL result are emitted; never zero-fill.
  - Sort the final array by `timestamp` ascending before returning, matching the raw path's contract.

### Phase 3: Validation

- [x] **Task 4: Measure aggregation CPU on the 389k-motion session** (depends on Task 3)
  Files: (no code change)
  Run the aggregated endpoint against the worst-case motion-heavy session (`dc8b6de1-…`, ~389k motion samples) over the full session span at a coarse `bucketSec`, and record query/CPU time. Note that unnest cost is **independent of `bucketSec`** — `@Min(1)` permits the heaviest grouping over the same ~2.3M leaves, and there is no server-side coarseness floor; this worst case is exactly what to measure. Confirm the response is a small min/max envelope (not 100k+ points) and that no stray epoch-0 bucket appears. If the on-the-fly cost is unacceptable, surface it (do not pre-build storage/caching speculatively — that is explicitly out of scope for this milestone). Capture the measurement in the milestone notes/PR description.
</content>
