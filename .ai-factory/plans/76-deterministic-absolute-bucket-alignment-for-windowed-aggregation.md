# Plan: Deterministic absolute bucket alignment for windowed aggregation

## Context
Guarantee that `listBiometrics`'s `?bucketSec` aggregation buckets against a stable ABSOLUTE origin (epoch) with half-open `[from, to)` semantics, so N adjacent windowed requests tile **byte-equal** to one full-session request at the same `bucketSec` — required by mind_web Phase 21 W2.

## Findings (current state)
- `SessionsService.aggregateBiometrics` (`src/sessions/sessions.service.ts`) already computes the bucket index as `floor((elem->>'timestamp')::numeric / bucketSec*1000)` — **epoch-anchored / absolute, NOT `from`-relative** (line 289). `from`/`to` only restrict which samples are scanned (`>= fromMs`, `< toMs`, lines 280/283), they do not shift the origin.
- The per-sample window filter is already **half-open** `[from, to)` on both the raw path (lines 202–203) and the aggregated path (lines 280, 283).
- `reshapeAggregatedBiometrics` derives `bucketStart = bucket * bucketSec * 1000` (epoch-anchored) and emits two synthetic samples per bucket: min at `bucketStart`, max at `bucketStart + bucketSec*500` (bucket midpoint) (lines 347–350).
- **Conclusion:** the origin is already absolute. Per spec note 59, this is a **verify + make-deterministic + document + test** task, not a re-anchoring rewrite. Contract shape is unchanged (synthetic min/max `BioSampleDto[]`). No migration (no schema change).

### Determinism gap that must be fixed (from plan review 1)
Although the *bucket set* is already `from`-independent, the production **output ordering is not deterministic**, so it is not actually byte-equal across requests:
- `reshapeAggregatedBiometrics` ends with `result.sort((a,b) => a.timestamp - b.timestamp)` — sorts **by timestamp only**. With multiple `sampleType`s (e.g. `motion` + others), every sampleType emits its *min* entry at the **same** `bucketStart` and its *max* at the same `bucketStart + bucketSec*500`. These collide on timestamp; JS stable sort then falls back to insertion order = `grouped.values()` = SQL row return order.
- The SQL has **no `ORDER BY`** (only `GROUP BY`, line 297), so Postgres does not guarantee stable row order. Two requests covering the same bucket (full-session vs the owning window), or even two identical full-session calls, can return same-timestamp entries in different orders → **not byte-equal in production**.
- Additionally, `data` object **key order** depends on row iteration order → must be made stable.

So the real code change is: **make the production reshape deterministic (total ordering + stable field-key order), and route both production and the test through one shared pure function** so the thing under test *is* the production code path — not a parallel mirror.

## Settings
- Testing: yes (milestone explicitly requires a byte-equal regression test)
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Make production reshape deterministic via a shared pure helper

- [x] **Task 1: Create `biometric-aggregation.util.ts` with the shared, deterministic boundary + reshape math**
  Files: `src/sessions/biometric-aggregation.util.ts` (new)
  Dependency-free module that is the single TypeScript source of truth for bucket boundaries and reshape ordering:
  - `bucketIndexForMs(tsMs, bucketSec)` → `Math.floor(tsMs / (bucketSec * 1000))` (epoch origin; mirrors SQL `floor(ts / bucketMs)`).
  - `bucketStartMs(bucketIndex, bucketSec)` → `bucketIndex * bucketSec * 1000`; plus a `bucketMaxOffsetMs(bucketSec)` = `bucketSec * 500` constant for the max-sample midpoint.
  - `reshapeAggregateRows(rows, bucketSec)`: pure, **deterministic** reshape of the SQL row shape `{ sampleType, bucket, field, min, max }[]` into the synthetic two-sample-per-bucket `Record<string, unknown>[]`. Determinism requirements:
    - Build each `data` object iterating fields in **sorted key order** (stable object-key order).
    - Apply a **total** sort to the result: by `(timestamp, sampleType)`. Min-before-max is intrinsic via the `+ bucketMaxOffsetMs` timestamp offset, so this tuple is a total order across all entries — insertion/row order becomes irrelevant.
  - `aggregateRawSamples(samples, bucketSec, fromMs?, toMs?)`: pure **reference** aggregator that produces the same `{ sampleType, bucket, field, min, max }[]` row shape the SQL produces — applies the half-open `[fromMs, toMs)` filter and groups by `(sampleType, bucketIndexForMs)` with per-field numeric min/max. To stay a faithful mirror, also apply the SQL's leaf/garbage rules: include only numeric `data` leaves and drop samples with `timestamp <= startedAt - GARBAGE_TS_SLACK_MS` (accept an optional `garbageBoundMs` param; document that these two rules are constant across windows so they don't affect the tiling assertion, but are mirrored so the helper is trustworthy as a reference). Used by the test only.

- [x] **Task 2: Route production `reshapeAggregatedBiometrics` through `reshapeAggregateRows`** (depends on Task 1)
  Files: `src/sessions/sessions.service.ts`
  Replace the body of `reshapeAggregatedBiometrics` so it delegates to `reshapeAggregateRows(rows, bucketSec)` — production now uses the exact deterministic function the test pins. This fixes the timestamp-tie non-determinism (total `(timestamp, sampleType)` order) and the `data` key-order non-determinism (sorted keys). Do NOT change the SQL aggregation strategy — the heavy unnest stays in Postgres. As defense-in-depth, optionally add `ORDER BY "sampleType", bucket, field` to the aggregation SQL; note in a comment that it is redundant once the reshape applies a total order, but harmless and clarifying.

### Phase 2: Document the invariant and verify

- [x] **Task 3: Document the absolute-origin / half-open / tiling contract and its limits in code** (depends on Task 2)
  Files: `src/sessions/sessions.service.ts`, `src/sessions/biometric-aggregation.util.ts`
  Add concise comments stating:
  - Bucket origin is **epoch 0** — request-`from`-independent and globally stable.
  - Window filter is **half-open `[from, to)`**.
  - **Tiling contract:** callers (mind_web `quantizeWindow`) MUST align window edges to `bucketSec` multiples so every bucket falls fully inside exactly one window; under that contract N adjacent windowed requests return the identical bucket set (same `bucketStart` timestamps + min/max values) as one full-session request, in identical order.
  - **`flushedAt` caveat (review #2):** rows are pre-filtered by `flushedAt`, not by sample `timestamp` (coarse filter + `FLUSHED_AT_PAD_MS`). The tiling guarantee assumes batches are flushed at or after the samples they contain (`flushedAt >= timestamp`); clock-skewed samples whose batch flushed before an interior window's `from` could appear in the full-session result but be dropped from that interior window. This skew case is **out of scope** for this milestone — document it as a known boundary, do not attempt to fix it here.
  - **SQL↔helper lockstep (review #3):** add a one-line comment next to the SQL `floor(... / bucketMs)` that it must stay in lockstep with `bucketIndexForMs`, and state honestly that because the unit test does not execute SQL, this equivalence is guarded by the comment/contract, not by the DB-less test (see Task 5).

- [x] **Task 4: Add the byte-equal full-session vs N-windowed-tiled regression test through the production reshape path** (depends on Tasks 1–2)
  Files: `src/sessions/biometric-aggregation.util.spec.ts` (new)
  Drive synthetic in-memory samples through `aggregateRawSamples(...)` → `reshapeAggregateRows(...)` (the SAME reshape production uses), comparing full-session vs N adjacent **bucket-aligned** half-open windows tiling the same range. Assert **byte-equality**: `expect(JSON.stringify(tiled)).toBe(JSON.stringify(full))`. Required cases:
  - **Multiple `sampleType`s sharing the same `bucketStart`** (review #1 — the case that breaks today): assert same-timestamp min entries and same-timestamp max entries appear in a stable, identical order in both full and tiled outputs.
  - Clean multi-window tiling; single-sample-per-bucket bucket.
  - Boundary sample with `timestamp` exactly equal to a window edge → appears in exactly one window (no seam, no double-count, no missing edge bucket).
  - `from`-independence: a window `[B, 3B)` and a window `[0, 4B)` yield identical `data`/timestamps for the buckets they share.

- [x] **Task 5 (optional, recommended): Postgres-backed integration test pinning SQL↔helper equivalence** (depends on Task 1)
  Files: `test/sessions-biometrics-aggregation.e2e-spec.ts` (new, `npm run test:e2e`)
  The unit suite is DB-less, so SQL↔helper drift (review #3) is otherwise unguarded. Add one e2e test that seeds a `ModuleSession` + `bio_session_samples` in the test Postgres, calls the real `SessionsService.listBiometrics` full-session vs tiled windows, and asserts byte-equality — and asserts the real SQL output matches `aggregateRawSamples` on the same data. If the orchestrator cannot provision a DB, skip this task and rely on the Task 3 lockstep comment; do not let a missing DB fail the unit gate.

## Notes / boundaries
- No contract shape change — still `?bucketSec` → synthetic min/max `BioSampleDto[]`.
- Independent of the separate smoothed-aggregation endpoint (`agg=avg|lttb`) — do not touch that milestone's code.
- Origin documented as **epoch 0** (already in use; request-`from`-independent). Do not switch to `session.startedAt`.
- Single logical change set → one commit at the end; no commit plan needed.
