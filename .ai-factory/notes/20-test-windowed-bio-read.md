# Test plan — windowed bio read tolerant of root-or-child (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[09-analytics-tolerant-bio-read]].

## Test authoring constraints (the four lessons)
- **L1 — outcomes only (THE note-16 trap, repeated here):** the legacy `rootSessionId = null` characterization MUST assert the **RETURNED SERIES** (the array of samples / aggregated rows the method returns), NEVER the where-clause / query shape. Today the raw path filters `where.moduleSessionId = sessionId` (`sessions.service.ts:177`) and the SQL path `b."moduleSessionId" = $sessionId` (`sessions.service.ts:276`); spec 09 rewrites these to `In([sessionId, rootSessionId])` / `= ANY($ids)`. Asserting `moduleSessionId === sessionId` (or the `In(...)`/`= ANY` shape) is exactly the L1 internal-key trap that cost note 16 a Medium bug. Assert data in → data out.
- **L2 — compile-now:** the `rootSessionId` column does not exist on `ModuleSession` yet (spec 02). On fixtures, set `rootSessionId` then cast the whole object `as any` (e.g. `makeSession({ ... , rootSessionId: 'root-1' } as any)`); for the legacy case use `rootSessionId: null as any`.
- **L3 — label by spec name:** target cases `RED until spec 09-analytics-tolerant-bio-read`; never a phase number.
- **L4 — escalation valve:** the legacy-identity cases are characterization invariants. A RED there post-spec-09 means the tolerant read changed legacy output → genuine Class-B, escalate. But ONLY if the assertion is on returned data (per L1); if it ever asserts the query shape, it was mis-classified → fix the test, do not escalate.

## Why this area (silent-failure filter)
Pure aggregation/windowing — the classic off-by-one silent bug. Wrong window bounds return the whole root timeline instead of a child's slice; an inclusive/exclusive mistake double-counts a boundary sample; a wrong default window makes overlapping activities return identical data. All produce plausible-but-wrong charts, no error. The SQL `bucket = floor(ts / bucketMs)` must stay in lockstep with `bucketIndexForMs` (epoch-0 origin).

## Behavior under change — think hard before writing
The read goes from `moduleSessionId = sessionId` to `In([sessionId, rootSessionId])` + a time window that **defaults to `[startedAt, endedAt]`**. Before writing, reason about why the default window is what makes overlapping children each get their own slice — and what breaks without it (a child returns the entire continuous root stream). Verify old data (`rootSessionId = null`) is provably identical to today. Edge cases the spec must survive → **Findings**.

## Red/Green contract
- **Target (RED until [[09-analytics-tolerant-bio-read]]):** root-branch + windowing cases.
- **Characterization (GREEN, stay GREEN):** for a session with `rootSessionId = null` (old data), every existing read path (raw, minmax, avg, lttb, 413 caps, instructions) returns exactly what it does today. A RED here = the tolerant read changed legacy behavior → Class B, escalate.

## Instantiation
`SessionsService(moduleSessionRepo, bioSampleRepo, streamSampleRepo)` (3 ctor args, `sessions.service.ts:50-57`). `assertSessionOwnership` does `moduleSessionRepo.findOne({ where: { id } })` (line 125) — stub it to return the session whose `startedAt`/`endedAt`/`rootSessionId` drive the window/source-set. **Raw path** (no `bucketSec`): stub `bioSampleRepo.find` to return rows with crafted `samples` jsonb arrays (shape `{ timestamp: number, sampleType, data }`, `sessions.service.ts:207`); assertable as a pure unit test. **SQL/aggregate path** (`bucketSec` set → `aggregateBiometrics`, lines 246-350): uses `bioSampleRepo.query(sql, params)` with `jsonb_array_elements` / `jsonb_each` unnest — CANNOT be faithfully unit-mocked. **Recommend an integration test against a seeded Postgres for the SQL path; keep the raw-path and window-boundary cases as unit tests.** (Note: no Postgres integration harness exists today — see note 22's blocking decision; the same harness gap applies here.)

## Test cases
### Raw path
- should query `In([sessionId, rootSessionId])` when rootSessionId is set — target→09
- should default the per-sample window to `[startedAt, endedAt]` when from/to absent — target→09
- should return only the child's slice of a longer root timeline — target→09
- should give two overlapping children each their own window of the same root rows — target→09
- should behave identically for `rootSessionId = null` (legacy) — char
- should not double-count a sample present once on the root — target→09
### Window boundaries
- should include `ts == from` and exclude `ts == to` — char/target→09. **Exact inclusivity from code (`sessions.service.ts:219-220`):** raw path skips `if (ts < fromMs) continue` and `if (ts >= toMs) continue` → **include `from`, exclude `to`** (half-open `[from, to)`). SQL path mirrors it: `>= fromMs` (line 299) and `< toMs` (line 302). Assert a sample exactly at `from` is present and one exactly at `to` is absent.
### Aggregation paths
- should keep `bucket = floor(ts/bucketMs)` aligned with `bucketIndexForMs` after the source-set change — char (SQL expression `floor((elem->>'timestamp')::numeric / bucketMs)`, `sessions.service.ts:313`; epoch-0 origin — integration test only, cannot unit-assert)
- should keep ROW_CAP / FLAT_CAP / LTTB_POINTS_ROW_CAP 413 guards — char (`ROW_CAP = 60_000` line 23, `FLAT_CAP = 50_000` line 24, `LTTB_POINTS_ROW_CAP = 3_000_000` line 33; `PayloadTooLargeException` at lines 201-204, 222-226, 343-347)

## Exact pins (read from source)
- **Source set today vs. after spec 09:** raw `where.moduleSessionId = sessionId` (`sessions.service.ts:176-178`); SQL `b."moduleSessionId" = ${sessionParam}` (line 276). Spec 09 → `In([sessionId, rootSessionId])` (raw) / `= ANY($ids)` (SQL). **Assert returned series, not these clauses** (L1).
- **Default per-sample window:** when `from`/`to` absent, spec 09 defaults the window to `[session.startedAt, session.endedAt]` so each child gets its own slice of the shared root stream. The session is already loaded by `assertSessionOwnership` (`sessions.service.ts:156`, returns the `ModuleSession`), so `startedAt`/`endedAt`/`rootSessionId` are available without an extra query.
- **No double-count:** a sample present once on the root must appear once when querying a child whose `rootSessionId` points at that root. Assert count, not membership only.
- **Coarse vs. exact filters both apply:** the `flushedAt` filter (padded by `FLUSHED_AT_PAD_MS = 120_000`, `sessions.service.ts:39`, applied at lines 182-193 raw / 284-295 SQL) is SEPARATE from the per-sample `timestamp` window (lines 219-220 raw / 298-303 SQL) — both must still apply after the source-set change.
- **Garbage-timestamp slack:** `GARBAGE_TS_SLACK_MS = 60_000` (`sessions.service.ts:44`) → SQL drops samples where `(elem->>'timestamp')::numeric <= session.startedAt - 60_000` (lines 268-269, 280). Must survive the `= ANY($ids)` change — but this is SQL-path-only (integration test).

## Gotchas
- `assertSessionOwnership` (`sessions.service.ts:121-135`) already loads the session — `startedAt`/`endedAt`/`rootSessionId` available without an extra query.
- The coarse `flushedAt` filter (padded by `FLUSHED_AT_PAD_MS`) is separate from the per-sample `timestamp` window — both must still apply.
- Garbage-timestamp slack (`GARBAGE_TS_SLACK_MS`) in the SQL path must survive the `= ANY($ids)` change.

## Findings
_(fill during test-writing; escalate to [[09-analytics-tolerant-bio-read]] before implementing it)_
