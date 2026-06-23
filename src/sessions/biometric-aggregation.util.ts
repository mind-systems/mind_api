/**
 * Bucket aggregation math and deterministic reshape for windowed biometric queries.
 *
 * Invariants:
 * - Bucket origin is epoch 0 — independent of request `from` and globally stable.
 * - Window filter is half-open [from, to).
 *
 * Tiling contract: callers (e.g. mind_web's quantizeWindow) MUST align window edges to
 * bucketSec multiples so every bucket falls fully inside exactly one window. Under that
 * contract N adjacent windowed requests return the identical bucket set (same bucketStart
 * timestamps and min/max values) as one full-session request, in identical order.
 *
 * flushedAt caveat: on the production path rows are pre-filtered by flushedAt (coarse
 * filter + FLUSHED_AT_PAD_MS), not by sample timestamp. The tiling guarantee assumes
 * batches are flushed at or after the samples they contain (flushedAt >= timestamp).
 * Clock-skewed samples whose batch flushed before an interior window's `from` could
 * appear in the full-session result but be dropped from that interior window. This skew
 * case is out of scope for this milestone.
 */

/** Aggregation mode for bucketed biometric queries. */
export type AggMode = 'minmax' | 'avg' | 'lttb';

/**
 * Numeric-leaf SQL cast reused by every strategy's selectColumns fragment.
 * Reads the scalar value from a JSONB kv pair returned by jsonb_each.
 */
const NUMERIC_LEAF = "(kv.value #>> '{}')::numeric";

/** Row shape returned by the SQL aggregation query (mirrored by aggregateRawSamples). */
export interface AggregateRow {
  sampleType: string;
  /** String-encoded integer bucket index as returned by Postgres. */
  bucket: string;
  field: string;
  /** String-encoded numeric as returned by Postgres. */
  min: string;
  /** String-encoded numeric as returned by Postgres. */
  max: string;
}

/**
 * Returns the bucket index for a timestamp in milliseconds.
 *
 * Origin is epoch 0. Must stay in lockstep with the SQL expression:
 *   floor((elem->>'timestamp')::numeric / bucketMs)
 * Because the unit test is DB-less, this equivalence is guarded by this comment/contract,
 * not by automated verification (see e2e integration test for SQL↔helper equivalence).
 */
export function bucketIndexForMs(tsMs: number, bucketSec: number): number {
  return Math.floor(tsMs / (bucketSec * 1000));
}

/**
 * Returns the epoch-anchored start timestamp (ms) of a bucket given its index.
 */
export function bucketStartMs(bucketIndex: number, bucketSec: number): number {
  return bucketIndex * bucketSec * 1000;
}

/**
 * Returns the offset (ms) from bucketStart to the bucket midpoint.
 * Used by both the min/max envelope (max sample placement) and the avg reducer
 * (single synthetic sample placement). Centralises the one source of truth.
 */
export function bucketMidpointOffsetMs(bucketSec: number): number {
  return bucketSec * 500;
}

/**
 * Returns the offset (ms) from bucketStart at which the max-sample is placed.
 * Delegates to bucketMidpointOffsetMs — the max sample sits at the bucket midpoint,
 * ensuring distinct timestamps for min and max samples and preventing envelope
 * polyline degeneration to vertical segments.
 */
export function bucketMaxOffsetMs(bucketSec: number): number {
  return bucketMidpointOffsetMs(bucketSec);
}

/**
 * Pure, deterministic reshape of SQL aggregate rows into synthetic two-sample-per-bucket
 * BioSampleDto-shaped records.
 *
 * Each (sampleType, bucket) pair emits exactly 2 records:
 *   - min sample at bucketStart, data fields in sorted key order.
 *   - max sample at bucketStart + bucketMaxOffsetMs, data fields in sorted key order.
 *
 * Determinism guarantees:
 *   1. Each `data` object's keys are iterated in sorted order — independent of SQL row order.
 *   2. The result is sorted by (timestamp, sampleType) — a total order that eliminates
 *      dependence on SQL row return order and Map insertion order.
 *
 * These two properties together guarantee byte-equal output for any two requests that
 * cover the same set of (sampleType, bucket, field) groups, regardless of Postgres row
 * ordering or JS runtime details.
 */
export function reshapeAggregateRows(
  rows: AggregateRow[],
  bucketSec: number,
): Record<string, unknown>[] {
  const grouped = new Map<
    string,
    {
      sampleType: string;
      bucket: number;
      minData: Record<string, number>;
      maxData: Record<string, number>;
    }
  >();

  for (const row of rows) {
    const bucket = Number(row.bucket);
    const key = `${row.sampleType}|${bucket}`;
    let group = grouped.get(key);
    if (!group) {
      group = {
        sampleType: row.sampleType,
        bucket,
        minData: {},
        maxData: {},
      };
      grouped.set(key, group);
    }
    group.minData[row.field] = Number(row.min);
    group.maxData[row.field] = Number(row.max);
  }

  const maxOffset = bucketMaxOffsetMs(bucketSec);
  const result: Record<string, unknown>[] = [];

  for (const { sampleType, bucket, minData, maxData } of grouped.values()) {
    const start = bucketStartMs(bucket, bucketSec);

    // Sort field keys for deterministic data object key ordering.
    const sortedFields = Object.keys(minData).sort();
    const minDataSorted: Record<string, number> = {};
    const maxDataSorted: Record<string, number> = {};
    for (const field of sortedFields) {
      minDataSorted[field] = minData[field];
      maxDataSorted[field] = maxData[field];
    }

    result.push({ timestamp: start, sampleType, data: minDataSorted });
    result.push({ timestamp: start + maxOffset, sampleType, data: maxDataSorted });
  }

  // Total sort by (timestamp, sampleType) — eliminates row-order and insertion-order dependence.
  // Min-before-max ordering is intrinsic via the bucketMaxOffsetMs timestamp offset, so this
  // two-field tuple is a total order across all output entries.
  result.sort((a, b) => {
    const tDiff = (a['timestamp'] as number) - (b['timestamp'] as number);
    if (tDiff !== 0) return tDiff;
    const sa = a['sampleType'] as string;
    const sb = b['sampleType'] as string;
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

  return result;
}

/** Row shape returned by the avg SQL aggregation query. */
export interface AvgRow {
  sampleType: string;
  /** String-encoded integer bucket index as returned by Postgres. */
  bucket: string;
  field: string;
  /** String-encoded numeric average as returned by Postgres. */
  avg: string;
}

/**
 * Pure, deterministic reshape of SQL avg-aggregate rows into one synthetic sample per
 * (sampleType, bucket) pair.
 *
 * Each group emits exactly one record:
 *   { timestamp: bucketStart + bucketMidpointOffsetMs, sampleType, data: <sorted-key object> }
 *
 * Determinism guarantees mirror reshapeAggregateRows:
 *   1. Each `data` object's keys are iterated in sorted order.
 *   2. The result is sorted by (timestamp, sampleType) — a total order independent of SQL
 *      row return order and Map insertion order.
 *
 * Empty buckets are skipped implicitly (no rows → no group). Garbage timestamps are already
 * excluded upstream by the SQL garbage-bound filter — no zero-fill here.
 */
export function reshapeAvgRows(
  rows: AvgRow[],
  bucketSec: number,
): Record<string, unknown>[] {
  const grouped = new Map<
    string,
    { sampleType: string; bucket: number; data: Record<string, number> }
  >();

  for (const row of rows) {
    const bucket = Number(row.bucket);
    const key = `${row.sampleType}|${bucket}`;
    let group = grouped.get(key);
    if (!group) {
      group = { sampleType: row.sampleType, bucket, data: {} };
      grouped.set(key, group);
    }
    group.data[row.field] = Number(row.avg);
  }

  const midOffset = bucketMidpointOffsetMs(bucketSec);
  const result: Record<string, unknown>[] = [];

  for (const { sampleType, bucket, data } of grouped.values()) {
    const start = bucketStartMs(bucket, bucketSec);

    // Sort field keys for deterministic data object key ordering.
    const sortedFields = Object.keys(data).sort();
    const dataSorted: Record<string, number> = {};
    for (const field of sortedFields) {
      dataSorted[field] = data[field];
    }

    result.push({ timestamp: start + midOffset, sampleType, data: dataSorted });
  }

  // Total sort by (timestamp, sampleType) — eliminates row-order and insertion-order dependence.
  result.sort((a, b) => {
    const tDiff = (a['timestamp'] as number) - (b['timestamp'] as number);
    if (tDiff !== 0) return tDiff;
    const sa = a['sampleType'] as string;
    const sb = b['sampleType'] as string;
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

  return result;
}

/** Row shape returned by the LTTB points query (one row per sample element field). */
export interface LttbRow {
  sampleType: string;
  /** String-encoded integer bucket index as returned by Postgres. */
  bucket: string;
  field: string;
  /** String-encoded numeric timestamp of the raw sample point as returned by Postgres. */
  ts: string;
  /** String-encoded numeric field value as returned by Postgres. */
  value: string;
}

/**
 * Selects one representative value from a non-empty, pre-sorted `(ts, value)` point list
 * using the bucket-local LTTB triangle criterion.
 *
 * Internal helper — not exported; used only by reshapeLttbRows.
 *
 * Selection rule (pinned — do not change without updating tests and plan):
 * - 1 point → that point's value.
 * - ≥2 points → A = first, C = last; for each candidate P compute
 *   area = |(C.ts − A.ts)·(P.value − A.value) − (P.ts − A.ts)·(C.value − A.value)|.
 *   Pick the max-area point. If all areas are 0 (collinear or two-point bucket),
 *   fall back to max |value − bucketMean|.
 *   Tie-break throughout: sort order wins (earliest ts, then smallest value).
 */
function selectLttbPoint(points: { ts: number; value: number }[]): number {
  const first = points[0];
  if (first === undefined) return 0; // guard: caller guarantees non-empty

  if (points.length === 1) return first.value;

  const a = first;
  const last = points[points.length - 1];
  if (last === undefined) return a.value; // guard for TS; points.length >= 2 makes this unreachable
  const c = last;

  // Triangle area without the /2 factor — monotonic, doesn't affect argmax.
  let maxArea = 0;
  let selected = a;

  for (const p of points) {
    const area = Math.abs(
      (c.ts - a.ts) * (p.value - a.value) - (p.ts - a.ts) * (c.value - a.value),
    );
    if (area > maxArea) {
      maxArea = area;
      selected = p;
    }
    // Ties: keep first occurrence — sort order guarantees earliest ts / smallest value wins.
  }

  if (maxArea === 0) {
    // All areas zero — collinear or exactly 2 points. Fallback: max |value − bucketMean|.
    const mean = points.reduce((s, p) => s + p.value, 0) / points.length;
    let maxDev = -1;
    selected = first; // reset; first in sort order wins ties
    for (const p of points) {
      const dev = Math.abs(p.value - mean);
      if (dev > maxDev) {
        maxDev = dev;
        selected = p;
      }
    }
  }

  return selected.value;
}

/**
 * Pure, deterministic reshape of LTTB points-query rows into one synthetic sample per
 * (sampleType, bucket) pair, using bucket-local triangle selection per field.
 *
 * For each (sampleType, bucket, field) group:
 *   - Sort points by (ts, value).
 *   - Pick the representative value with selectLttbPoint (triangle area vs the bucket's own
 *     first/last chord; see the plan's Key Design Decision for the rationale).
 *
 * Each group emits exactly one record:
 *   { timestamp: bucketStart + bucketMidpointOffsetMs, sampleType, data: <sorted-key object> }
 *
 * Determinism guarantees mirror reshapeAvgRows:
 *   1. Each `data` object's keys are in sorted order.
 *   2. The result is sorted by (timestamp, sampleType).
 *
 * Accepted limitation (do not "fix"): a spike that is the bucket's first or last point sits on
 * the chord (area 0) and is not selected by the triangle criterion unless every area in the
 * bucket is 0. A near-monotonic bucket whose extreme is on an edge maps to a less-extreme
 * interior point. Acceptable for a comparison testbed; recorded here so QA does not file it
 * as a bug.
 */
export function reshapeLttbRows(
  rows: LttbRow[],
  bucketSec: number,
): Record<string, unknown>[] {
  // Group per (sampleType, bucket, field) → collect raw points.
  const fieldGroups = new Map<
    string,
    { sampleType: string; bucket: number; field: string; points: { ts: number; value: number }[] }
  >();

  for (const row of rows) {
    const bucket = Number(row.bucket);
    const key = `${row.sampleType}|${bucket}|${row.field}`;
    let group = fieldGroups.get(key);
    if (!group) {
      group = { sampleType: row.sampleType, bucket, field: row.field, points: [] };
      fieldGroups.set(key, group);
    }
    group.points.push({ ts: Number(row.ts), value: Number(row.value) });
  }

  // For each (sampleType, bucket), collect the per-field selected values.
  const bucketGroups = new Map<
    string,
    { sampleType: string; bucket: number; data: Record<string, number> }
  >();

  for (const { sampleType, bucket, field, points } of fieldGroups.values()) {
    if (points.length === 0) continue;

    // Sort by (ts, value) for deterministic tie-breaking in selectLttbPoint.
    points.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.value - b.value));

    const selectedValue = selectLttbPoint(points);

    const bucketKey = `${sampleType}|${bucket}`;
    let bucketGroup = bucketGroups.get(bucketKey);
    if (!bucketGroup) {
      bucketGroup = { sampleType, bucket, data: {} };
      bucketGroups.set(bucketKey, bucketGroup);
    }
    bucketGroup.data[field] = selectedValue;
  }

  const midOffset = bucketMidpointOffsetMs(bucketSec);
  const result: Record<string, unknown>[] = [];

  for (const { sampleType, bucket, data } of bucketGroups.values()) {
    const start = bucketStartMs(bucket, bucketSec);

    // Sort field keys for deterministic data object key ordering.
    const sortedFields = Object.keys(data).sort();
    const dataSorted: Record<string, number> = {};
    for (const f of sortedFields) {
      dataSorted[f] = data[f] as number;
    }

    result.push({ timestamp: start + midOffset, sampleType, data: dataSorted });
  }

  // Total sort by (timestamp, sampleType) — eliminates row-order and insertion-order dependence.
  result.sort((a, b) => {
    const tDiff = (a['timestamp'] as number) - (b['timestamp'] as number);
    if (tDiff !== 0) return tDiff;
    const sa = a['sampleType'] as string;
    const sb = b['sampleType'] as string;
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

  return result;
}

/**
 * Pure in-memory reference point collector that mirrors the LTTB points SQL query.
 * Applies the same half-open [fromMs, toMs) window filter and garbage timestamp filter,
 * then emits one LttbRow per (sampleType, bucket, field, ts, value) — no aggregation.
 *
 * Used by unit tests only — never called on the production code path.
 * Mirrors collectRawPoints the same way aggregateRawSamples mirrors the grouped SQL.
 *
 * @param samples         Raw sample records from bio_session_samples.
 * @param bucketSec       Bucket width in seconds.
 * @param fromMs          Lower bound, inclusive (half-open [fromMs, toMs)); omit for no bound.
 * @param toMs            Upper bound, exclusive; omit for no bound.
 * @param garbageBoundMs  Samples with timestamp <= garbageBoundMs are dropped.
 */
export function collectRawPoints(
  samples: Record<string, unknown>[],
  bucketSec: number,
  fromMs?: number,
  toMs?: number,
  garbageBoundMs?: number,
): LttbRow[] {
  const result: LttbRow[] = [];

  for (const sample of samples) {
    const ts =
      typeof sample['timestamp'] === 'number' ? sample['timestamp'] : undefined;
    if (ts === undefined) continue;

    // Garbage filter: mirrors SQL `(elem->>'timestamp')::numeric > garbageBoundParam`
    if (garbageBoundMs !== undefined && ts <= garbageBoundMs) continue;

    // Half-open [fromMs, toMs) window filter
    if (fromMs !== undefined && ts < fromMs) continue;
    if (toMs !== undefined && ts >= toMs) continue;

    const sampleType =
      typeof sample['sampleType'] === 'string' ? sample['sampleType'] : undefined;
    if (sampleType === undefined) continue;

    const data = sample['data'];
    if (data === null || typeof data !== 'object' || Array.isArray(data)) continue;

    const bucket = bucketIndexForMs(ts, bucketSec);

    for (const [field, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value !== 'number') continue; // only numeric leaves

      result.push({
        sampleType,
        bucket: String(bucket),
        field,
        ts: String(ts),
        value: String(value),
      });
    }
  }

  return result;
}

/**
 * Reducer-strategy registry keyed by AggMode.
 *
 * Each entry provides:
 *   - `kind`: `'grouped'` entries use GROUP BY + aggregate functions and return a compact
 *     rowset (one row per (sampleType, bucket, field)). `'points'` entries return one raw
 *     row per (sampleType, bucket, field, sample point) — a potentially large rowset that
 *     requires a dedicated LTTB_POINTS_ROW_CAP guard in the service.
 *   - `selectColumns`: SQL fragment appended to the shared SELECT header. For `'grouped'`
 *     entries this is an aggregate function; for `'points'` entries it adds per-point columns
 *     (ts, value) that the reshape function consumes.
 *   - `reshape`: pure function that converts raw Postgres rows into the final
 *     BioSampleDto-shaped array.
 *
 * Adding a new strategy requires only a new entry here plus a corresponding reshape
 * function. If `kind === 'points'`, the service omits GROUP BY/ORDER BY and applies the
 * LTTB_POINTS_ROW_CAP guard — no other service changes needed.
 */
export const AGG_REGISTRY: Record<
  AggMode,
  {
    kind: 'grouped' | 'points';
    selectColumns: string;
    reshape: (
      rows: Record<string, unknown>[],
      bucketSec: number,
    ) => Record<string, unknown>[];
  }
> = {
  minmax: {
    kind: 'grouped',
    selectColumns: `min(${NUMERIC_LEAF}) AS min, max(${NUMERIC_LEAF}) AS max`,
    reshape: (rows, bucketSec) =>
      reshapeAggregateRows(rows as unknown as AggregateRow[], bucketSec),
  },
  avg: {
    kind: 'grouped',
    selectColumns: `avg(${NUMERIC_LEAF}) AS avg`,
    reshape: (rows, bucketSec) =>
      reshapeAvgRows(rows as unknown as AvgRow[], bucketSec),
  },
  lttb: {
    kind: 'points',
    selectColumns: `(elem->>'timestamp')::numeric AS ts, ${NUMERIC_LEAF} AS value`,
    reshape: (rows, bucketSec) =>
      reshapeLttbRows(rows as unknown as LttbRow[], bucketSec),
  },
};

/**
 * Pure in-memory reference aggregator that mirrors the SQL aggregation query used on the
 * production path. Applies the same half-open [fromMs, toMs) window filter, garbage
 * timestamp filter, and per-(sampleType, bucket, field) numeric min/max grouping.
 *
 * Used by unit tests only — never called on the production code path.
 *
 * The two filter rules (garbage bound + half-open window) are constant across windows so
 * they do not affect the tiling assertion, but are mirrored here so that the helper is
 * a trustworthy reference when verifying full-session vs windowed equivalence.
 *
 * @param samples     Raw sample records (JSONB array elements) from bio_session_samples.
 * @param bucketSec   Bucket width in seconds.
 * @param fromMs      Lower bound, inclusive (half-open [fromMs, toMs)); omit for no bound.
 * @param toMs        Upper bound, exclusive; omit for no bound.
 * @param garbageBoundMs  Samples with timestamp <= garbageBoundMs are dropped.
 *                        Mirrors SQL: (elem->>'timestamp')::numeric > garbageBoundParam.
 *                        Pass session.startedAt.getTime() - GARBAGE_TS_SLACK_MS to match
 *                        production behaviour; omit to skip the garbage filter in tests.
 */
export function aggregateRawSamples(
  samples: Record<string, unknown>[],
  bucketSec: number,
  fromMs?: number,
  toMs?: number,
  garbageBoundMs?: number,
): AggregateRow[] {
  const grouped = new Map<
    string,
    { sampleType: string; bucket: number; field: string; min: number; max: number }
  >();

  for (const sample of samples) {
    const ts =
      typeof sample['timestamp'] === 'number' ? sample['timestamp'] : undefined;
    if (ts === undefined) continue;

    // Garbage filter: mirrors SQL `(elem->>'timestamp')::numeric > garbageBoundParam`
    if (garbageBoundMs !== undefined && ts <= garbageBoundMs) continue;

    // Half-open [fromMs, toMs) window filter
    if (fromMs !== undefined && ts < fromMs) continue;
    if (toMs !== undefined && ts >= toMs) continue;

    const sampleType =
      typeof sample['sampleType'] === 'string' ? sample['sampleType'] : undefined;
    if (sampleType === undefined) continue;

    const data = sample['data'];
    if (data === null || typeof data !== 'object' || Array.isArray(data)) continue;

    const bucket = bucketIndexForMs(ts, bucketSec);

    for (const [field, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (typeof value !== 'number') continue; // only numeric leaves

      const key = `${sampleType}|${bucket}|${field}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { sampleType, bucket, field, min: value, max: value });
      } else {
        if (value < existing.min) existing.min = value;
        if (value > existing.max) existing.max = value;
      }
    }
  }

  // Return rows in the same flat shape the SQL query returns (all values as strings).
  return Array.from(grouped.values()).map(({ sampleType, bucket, field, min, max }) => ({
    sampleType,
    bucket: String(bucket),
    field,
    min: String(min),
    max: String(max),
  }));
}
