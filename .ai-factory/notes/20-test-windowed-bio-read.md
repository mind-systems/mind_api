# Test plan — windowed bio read tolerant of root-or-child (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[09-analytics-tolerant-bio-read]].

## Why this area (silent-failure filter)
Pure aggregation/windowing — the classic off-by-one silent bug. Wrong window bounds return the whole root timeline instead of a child's slice; an inclusive/exclusive mistake double-counts a boundary sample; a wrong default window makes overlapping activities return identical data. All produce plausible-but-wrong charts, no error. The SQL `bucket = floor(ts / bucketMs)` must stay in lockstep with `bucketIndexForMs` (epoch-0 origin).

## Behavior under change — think hard before writing
The read goes from `moduleSessionId = sessionId` to `In([sessionId, rootSessionId])` + a time window that **defaults to `[startedAt, endedAt]`**. Before writing, reason about why the default window is what makes overlapping children each get their own slice — and what breaks without it (a child returns the entire continuous root stream). Verify old data (`rootSessionId = null`) is provably identical to today. Edge cases the spec must survive → **Findings**.

## Red/Green contract
- **Target (RED until [[09-analytics-tolerant-bio-read]]):** root-branch + windowing cases.
- **Characterization (GREEN, stay GREEN):** for a session with `rootSessionId = null` (old data), every existing read path (raw, minmax, avg, lttb, 413 caps, instructions) returns exactly what it does today. A RED here = the tolerant read changed legacy behavior → Class B, escalate.

## Instantiation
`SessionsService` with mocked `Repository<BioSessionSample>` / `Repository<ModuleSession>`. For the SQL path, prefer an integration test against a seeded Postgres (the unnest/jsonb logic cannot be faithfully unit-mocked); for the raw path, stub `find` with crafted jsonb sample arrays.

## Test cases
### Raw path
- should query `In([sessionId, rootSessionId])` when rootSessionId is set — target→09
- should default the per-sample window to `[startedAt, endedAt]` when from/to absent — target→09
- should return only the child's slice of a longer root timeline — target→09
- should give two overlapping children each their own window of the same root rows — target→09
- should behave identically for `rootSessionId = null` (legacy) — char
- should not double-count a sample present once on the root — target→09
### Window boundaries
- should include `ts == from` and exclude `ts == to` (match current `< toMs` / `>= fromMs`) — char/target→09
### Aggregation paths
- should keep `bucket = floor(ts/bucketMs)` aligned with `bucketIndexForMs` after the source-set change — char
- should keep ROW_CAP / FLAT_CAP / LTTB_POINTS_ROW_CAP 413 guards — char

## Gotchas
- `assertSessionOwnership` already loads the session — `startedAt`/`endedAt`/`rootSessionId` are available without an extra query.
- The coarse `flushedAt` filter (padded by `FLUSHED_AT_PAD_MS`) is separate from the per-sample `timestamp` window — both must still apply.
- Garbage-timestamp slack (`GARBAGE_TS_SLACK_MS`) in the SQL path must survive the `= ANY($ids)` change.

## Findings
_(fill during test-writing; escalate to [[09-analytics-tolerant-bio-read]] before implementing it)_
