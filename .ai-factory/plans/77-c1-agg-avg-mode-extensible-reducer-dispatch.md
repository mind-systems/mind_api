# Plan: (C1) `agg=avg` mode + extensible reducer dispatch

## Context
Add an optional `agg` query param (`minmax` default | `avg`) to `GET /sessions/runs/:id/biometrics`, dispatching the bucketed aggregation through a small reducer-strategy registry so `avg` emits one synthetic averaged sample per `(sampleType, bucket)` while the existing min/max envelope stays byte-identical when `agg` is absent.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Reducer strategy registry (util)

- [x] **Task 1: Add the `avg` reshape + reducer-strategy registry to `biometric-aggregation.util.ts`**
  Files: `src/sessions/biometric-aggregation.util.ts`
  Build the extension point so future reducers (`median`, `lttb`, …) are a small addition.
  - Define `export type AggMode = 'minmax' | 'avg';`.
  - Extract the numeric-leaf SQL cast into a shared constant, e.g. `const NUMERIC_LEAF = "(kv.value #>> '{}')::numeric";`, to be reused by every strategy's select fragment.
  - Add `export function bucketMidpointOffsetMs(bucketSec: number): number { return bucketSec * 500; }` (same value the existing `bucketMaxOffsetMs` computes — the `avg` sample sits at the bucket midpoint, `bucketStart + bucketSec*500`, ms). Have `bucketMaxOffsetMs` delegate to it to keep one source of truth, or document the equivalence inline.
  - Add `export interface AvgRow { sampleType: string; bucket: string; field: string; avg: string; }`.
  - Add `export function reshapeAvgRows(rows: AvgRow[], bucketSec: number): Record<string, unknown>[]` mirroring the determinism guarantees of `reshapeAggregateRows`:
    - Group by `(sampleType, bucket)`; accumulate `data[field] = Number(row.avg)`.
    - Emit exactly **one** record per group: `{ timestamp: bucketStartMs(bucket, bucketSec) + bucketMidpointOffsetMs(bucketSec), sampleType, data: <sorted-key object> }`.
    - Sort `data` keys (matches `reshapeAggregateRows`) and sort the final array by `(timestamp, sampleType)` for byte-equal, tiling-stable output.
    - Skip empty buckets implicitly (no rows → no group; no zero-fill). `timestamp=0`/garbage samples are already excluded upstream by the SQL garbage-bound filter — do not re-add zero-fill.
  - Add a strategy registry mapping `AggMode` → `{ selectColumns: string; reshape: (rows, bucketSec) => Record<string, unknown>[] }`:
    - `minmax`: `selectColumns: \`min(${NUMERIC_LEAF}) AS min, max(${NUMERIC_LEAF}) AS max\``, `reshape: reshapeAggregateRows` — must produce SQL/output identical to today's hardcoded query.
    - `avg`: `selectColumns: \`avg(${NUMERIC_LEAF}) AS avg\``, `reshape: reshapeAvgRows`.
  - Keep the existing `reshapeAggregateRows`, `bucketIndexForMs`, `bucketStartMs`, and `aggregateRawSamples` exports unchanged.

### Phase 2: Service dispatch

- [x] **Task 2: Parametrize `aggregateBiometrics` by reducer strategy** (depends on Task 1)
  Files: `src/sessions/sessions.service.ts`
  - Add an `agg: AggMode` parameter to `aggregateBiometrics`.
  - Replace the hardcoded `min(...) AS min, max(...) AS max` select lines with the strategy's `selectColumns` from the registry. Leave `FROM`, all `WHERE` conditions (session id, `jsonb_typeof` guards, garbage-bound, coarse `flushedAt`, half-open `[from, to)` per-sample filter), `GROUP BY "sampleType", bucket, field`, and `ORDER BY` exactly as they are — the absolute epoch-grid `floor(ts / bucketMs)` bucket expression (Phase 49 anchoring) must stay byte-for-byte so windowed `avg` tiles.
  - Return type becomes the raw row set (`Record<string, unknown>[]`); the strategy's `reshape` consumes it. No `ROW_CAP`/`FLAT_CAP`/413 guard on this path (aggregation stays in Postgres) — keep that property.
  - Keep the SQL-vs-`bucketIndexForMs` lockstep comment.

- [x] **Task 3: Dispatch `agg` in `listBiometrics`** (depends on Task 2)
  Files: `src/sessions/sessions.service.ts`
  - Add an `agg?: string` parameter to `listBiometrics` (after `bucketSec`).
  - In the `bucketSec !== undefined` branch, resolve `const mode: AggMode = (agg ?? 'minmax') as AggMode;`, look up the strategy from the registry, call `aggregateBiometrics(session, bucketSec, mode, from, to)`, then `strategy.reshape(rows, bucketSec)`. Defensive default to `minmax` for unset/undefined so `agg` absent ⇒ byte-identical min/max envelope.
  - The raw (no `bucketSec`) path is unchanged — `agg` is ignored there; the 413 raw guard stays intact.

### Phase 3: HTTP contract

- [x] **Task 4: Add and validate the `agg` query param** (depends on Task 3)
  Files: `src/sessions/dto/time-range-query.dto.ts`, `src/sessions/sessions.controller.ts`
  - In `TimeRangeQueryDto` add `@IsOptional() @IsIn(['minmax', 'avg']) agg?: string;` (import `IsIn` from `class-validator`). An unknown value fails validation → `400` automatically via the global validation pipe. Do not default in the DTO — absence is handled in the service.
  - In `SessionsController.listBiometrics`, pass `query.agg` as the new final argument to `sessionsService.listBiometrics(...)`.
