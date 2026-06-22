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
 * Returns the offset (ms) from bucketStart at which the max-sample is placed.
 * Using the bucket midpoint (bucketSec * 500 ms) ensures distinct timestamps for
 * min and max samples, preventing envelope polyline degeneration to vertical segments.
 */
export function bucketMaxOffsetMs(bucketSec: number): number {
  return bucketSec * 500;
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
