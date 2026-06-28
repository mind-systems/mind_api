import {
  aggregateRawSamples,
  collectRawPoints,
  reshapeAggregateRows,
  reshapeAvgRows,
  reshapeLttbRows,
} from './biometric-aggregation.util';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build a synthetic sample for the given sampleType at timestamp tsMs. */
function makeSample(
  sampleType: string,
  tsMs: number,
  data: Record<string, number>,
): Record<string, unknown> {
  return { timestamp: tsMs, sampleType, data };
}

/**
 * LTTB aggregate + reshape for a specific [fromMs, toMs) window.
 * Mirrors the production path: collectRawPoints → reshapeLttbRows.
 */
function processLttb(
  samples: Record<string, unknown>[],
  bucketSec: number,
  fromMs?: number,
  toMs?: number,
  garbageBoundMs?: number,
): Record<string, unknown>[] {
  const rows = collectRawPoints(
    samples,
    bucketSec,
    fromMs,
    toMs,
    garbageBoundMs,
  );
  return reshapeLttbRows(rows, bucketSec);
}

/**
 * Avg aggregate + reshape for a specific [fromMs, toMs) window.
 * Builds avg rows from collectRawPoints (since aggregateRawSamples returns min/max, not avg),
 * then delegates to reshapeAvgRows. Used only to contrast lttb vs avg in spike tests.
 */
function processAvg(
  samples: Record<string, unknown>[],
  bucketSec: number,
  fromMs?: number,
  toMs?: number,
  garbageBoundMs?: number,
): Record<string, unknown>[] {
  const points = collectRawPoints(
    samples,
    bucketSec,
    fromMs,
    toMs,
    garbageBoundMs,
  );

  const sums = new Map<
    string,
    {
      sampleType: string;
      bucket: string;
      field: string;
      sum: number;
      count: number;
    }
  >();
  for (const pt of points) {
    const key = `${pt.sampleType}|${pt.bucket}|${pt.field}`;
    const existing = sums.get(key);
    if (existing) {
      existing.sum += Number(pt.value);
      existing.count += 1;
    } else {
      sums.set(key, {
        sampleType: pt.sampleType,
        bucket: pt.bucket,
        field: pt.field,
        sum: Number(pt.value),
        count: 1,
      });
    }
  }

  const avgRows = Array.from(sums.values()).map(
    ({ sampleType, bucket, field, sum, count }) => ({
      sampleType,
      bucket,
      field,
      avg: String(sum / count),
    }),
  );

  return reshapeAvgRows(avgRows, bucketSec);
}

/**
 * Aggregate then reshape the given raw samples for a specific [fromMs, toMs) window.
 * Mirrors the production path: aggregateBiometrics rows → AGG_REGISTRY[mode].reshape.
 */
function process(
  samples: Record<string, unknown>[],
  bucketSec: number,
  fromMs?: number,
  toMs?: number,
  garbageBoundMs?: number,
): Record<string, unknown>[] {
  const rows = aggregateRawSamples(
    samples,
    bucketSec,
    fromMs,
    toMs,
    garbageBoundMs,
  );
  return reshapeAggregateRows(rows, bucketSec);
}

// ─── constants ────────────────────────────────────────────────────────────────

// Keep these two in sync: BMS = BSEC * 1000.
const BSEC = 10; // bucketSec argument  (seconds)
const BMS = BSEC * 1000; // bucket width in ms  (= 10 000 ms)

// ─── tests ────────────────────────────────────────────────────────────────────

describe('biometric-aggregation.util', () => {
  describe('tiling: full-session equals N adjacent windows', () => {
    it('single sampleType — 3 windows tile a full session', () => {
      const samples = [
        makeSample('motion', 0 * BMS + 1_000, { x: 1, y: 10 }), // bucket 0
        makeSample('motion', 0 * BMS + 5_000, { x: 3, y: 20 }), // bucket 0
        makeSample('motion', 1 * BMS + 2_000, { x: 5, y: 30 }), // bucket 1
        makeSample('motion', 2 * BMS + 8_000, { x: 7, y: 40 }), // bucket 2
      ];

      const full = process(samples, BSEC, 0 * BMS, 3 * BMS);

      const w0 = process(samples, BSEC, 0 * BMS, 1 * BMS);
      const w1 = process(samples, BSEC, 1 * BMS, 2 * BMS);
      const w2 = process(samples, BSEC, 2 * BMS, 3 * BMS);
      const tiled = [...w0, ...w1, ...w2];

      expect(JSON.stringify(tiled)).toBe(JSON.stringify(full));
    });

    it('multiple sampleTypes sharing the same bucketStart — critical ordering case', () => {
      // Both sampleTypes land in bucket 0: their min entries share timestamp bucketStart
      // and their max entries share timestamp bucketStart+offset. This is the case that
      // broke the old sort-by-timestamp-only implementation.
      const samples = [
        makeSample('alpha', 0 * BMS + 1_000, { val: 10 }),
        makeSample('alpha', 0 * BMS + 9_000, { val: 90 }),
        makeSample('beta', 0 * BMS + 2_000, { val: 20 }),
        makeSample('beta', 0 * BMS + 8_000, { val: 80 }),
      ];

      const full = process(samples, BSEC, 0 * BMS, 1 * BMS);
      // Single window — just verify it is stable across two identical calls.
      const second = process(samples, BSEC, 0 * BMS, 1 * BMS);
      expect(JSON.stringify(full)).toBe(JSON.stringify(second));

      // Verify ordering: result must be sorted by (timestamp ASC, sampleType ASC).
      // min entries for both sampleTypes appear before max entries.
      const timestamps = full.map((s) => s['timestamp'] as number);
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));

      // Within the same timestamp, sampleType must be sorted lexicographically.
      const sameTs = full.filter((s) => s['timestamp'] === 0 * BMS);
      const sameTypes = sameTs.map((s) => s['sampleType'] as string);
      expect(sameTypes).toEqual([...sameTypes].sort());
    });

    it('multiple sampleTypes across multiple windows tile byte-equal', () => {
      const samples = [
        // bucket 0
        makeSample('alpha', 0 * BMS + 1_000, { a: 1, z: 100 }),
        makeSample('alpha', 0 * BMS + 9_000, { a: 9, z: 900 }),
        makeSample('beta', 0 * BMS + 3_000, { b: 3 }),
        makeSample('beta', 0 * BMS + 7_000, { b: 77 }),
        // bucket 1
        makeSample('alpha', 1 * BMS + 500, { a: 2, z: 200 }),
        makeSample('beta', 1 * BMS + 5_000, { b: 5 }),
      ];

      const full = process(samples, BSEC, 0, 2 * BMS);
      const w0 = process(samples, BSEC, 0 * BMS, 1 * BMS);
      const w1 = process(samples, BSEC, 1 * BMS, 2 * BMS);
      const tiled = [...w0, ...w1];

      expect(JSON.stringify(tiled)).toBe(JSON.stringify(full));
    });
  });

  describe('window boundary semantics', () => {
    it('boundary sample exactly at window edge falls in the lower window only (half-open [from, to))', () => {
      const edgeTs = 1 * BMS; // exactly at the boundary between bucket 0 and bucket 1
      const samples = [makeSample('motion', edgeTs, { x: 42 })];

      const w0 = process(samples, BSEC, 0 * BMS, 1 * BMS); // [0, BMS) — must NOT include edgeTs
      const w1 = process(samples, BSEC, 1 * BMS, 2 * BMS); // [BMS, 2BMS) — must include edgeTs

      expect(w0).toHaveLength(0);
      expect(w1).toHaveLength(2); // one bucket → 2 synthetic samples (min + max)
    });

    it('no seam: concatenating two adjacent windows contains the boundary sample exactly once', () => {
      const samples = [
        makeSample('motion', 0 * BMS + 5_000, { x: 1 }), // bucket 0
        makeSample('motion', 1 * BMS, { x: 2 }), // exactly at boundary → bucket 1
        makeSample('motion', 1 * BMS + 5_000, { x: 3 }), // bucket 1
      ];

      const full = process(samples, BSEC, 0 * BMS, 2 * BMS);
      const w0 = process(samples, BSEC, 0 * BMS, 1 * BMS);
      const w1 = process(samples, BSEC, 1 * BMS, 2 * BMS);
      const tiled = [...w0, ...w1];

      expect(JSON.stringify(tiled)).toBe(JSON.stringify(full));
    });
  });

  describe('from-independence (absolute origin)', () => {
    it('overlapping sub-window and full window yield identical data for shared buckets', () => {
      // Samples land in buckets 1, 2, 3.
      const samples = [
        makeSample('motion', 1 * BMS + 1_000, { x: 10 }),
        makeSample('motion', 1 * BMS + 9_000, { x: 90 }),
        makeSample('motion', 2 * BMS + 1_000, { x: 20 }),
        makeSample('motion', 3 * BMS + 1_000, { x: 30 }),
      ];

      // Full range: [BMS, 4*BMS)
      const full = process(samples, BSEC, 1 * BMS, 4 * BMS);

      // Sub-window: [BMS, 3*BMS) — covers buckets 1 and 2
      const sub = process(samples, BSEC, 1 * BMS, 3 * BMS);

      // The entries for bucket 1 (bucketStart = BMS, maxTs = BMS + BSEC*500)
      // should be identical in both outputs.
      const fullBucket1 = full.filter(
        (s) => (s['timestamp'] as number) < 2 * BMS,
      );
      const subBucket1 = sub.filter(
        (s) => (s['timestamp'] as number) < 2 * BMS,
      );
      expect(JSON.stringify(subBucket1)).toBe(JSON.stringify(fullBucket1));
    });

    it('window [BMS, 3*BMS) and window [0, 4*BMS) yield identical data for their shared buckets', () => {
      const samples = [
        makeSample('motion', 0 * BMS + 5_000, { x: 5 }), // bucket 0 (only in wide)
        makeSample('motion', 1 * BMS + 5_000, { x: 15 }), // bucket 1 (shared)
        makeSample('motion', 2 * BMS + 5_000, { x: 25 }), // bucket 2 (shared)
        makeSample('motion', 3 * BMS + 5_000, { x: 35 }), // bucket 3 (only in wide)
      ];

      const narrow = process(samples, BSEC, 1 * BMS, 3 * BMS); // buckets 1, 2
      const wide = process(samples, BSEC, 0 * BMS, 4 * BMS); // buckets 0, 1, 2, 3

      // Shared buckets 1 and 2: timestamps in [BMS, 3*BMS)
      const wideShared = wide.filter(
        (s) =>
          (s['timestamp'] as number) >= 1 * BMS &&
          (s['timestamp'] as number) < 3 * BMS,
      );
      expect(JSON.stringify(narrow)).toBe(JSON.stringify(wideShared));
    });
  });

  describe('single-sample-per-bucket', () => {
    it('one sample per bucket produces correct min=max envelope', () => {
      const samples = [makeSample('hr', 5_000, { bpm: 60 })];
      const result = process(samples, BSEC);

      expect(result).toHaveLength(2);
      const [minEntry, maxEntry] = result as Array<{
        timestamp: number;
        sampleType: string;
        data: { bpm: number };
      }>;

      expect(minEntry.data.bpm).toBe(60);
      expect(maxEntry.data.bpm).toBe(60);
      expect(minEntry.timestamp).toBe(0); // bucket 0 start
      expect(maxEntry.timestamp).toBe(BSEC * 500); // bucketMaxOffsetMs(BSEC)
    });
  });

  describe('determinism: data key ordering', () => {
    it('data object field keys are always in sorted order regardless of sample insertion order', () => {
      // Insert fields in reverse alphabetical order — output must be sorted.
      const samples = [makeSample('sensor', 5_000, { z: 3, m: 2, a: 1 })];
      const [minEntry] = process(samples, BSEC) as Array<{
        timestamp: number;
        data: Record<string, number>;
      }>;

      const keys = Object.keys(minEntry.data);
      expect(keys).toEqual([...keys].sort());
    });

    it('two identical calls produce the same JSON string', () => {
      const samples = [
        makeSample('alpha', 0 * BMS + 1_000, { val: 10 }),
        makeSample('beta', 0 * BMS + 2_000, { val: 20 }),
      ];
      const first = JSON.stringify(process(samples, BSEC));
      const second = JSON.stringify(process(samples, BSEC));
      expect(first).toBe(second);
    });
  });

  // ─── lttb ─────────────────────────────────────────────────────────────────

  describe('lttb: tiling byte-equality', () => {
    it('single sampleType — 3 adjacent windows tile a full-session request', () => {
      const samples = [
        makeSample('motion', 0 * BMS + 1_000, { x: 1, y: 10 }), // bucket 0
        makeSample('motion', 0 * BMS + 5_000, { x: 3, y: 20 }), // bucket 0
        makeSample('motion', 1 * BMS + 2_000, { x: 5, y: 30 }), // bucket 1
        makeSample('motion', 2 * BMS + 8_000, { x: 7, y: 40 }), // bucket 2
      ];

      const full = processLttb(samples, BSEC, 0 * BMS, 3 * BMS);
      const w0 = processLttb(samples, BSEC, 0 * BMS, 1 * BMS);
      const w1 = processLttb(samples, BSEC, 1 * BMS, 2 * BMS);
      const w2 = processLttb(samples, BSEC, 2 * BMS, 3 * BMS);
      const tiled = [...w0, ...w1, ...w2];

      expect(JSON.stringify(tiled)).toBe(JSON.stringify(full));
    });

    it('multiple sampleTypes sharing the same bucketStart — critical ordering case', () => {
      const samples = [
        makeSample('alpha', 0 * BMS + 1_000, { val: 10 }),
        makeSample('alpha', 0 * BMS + 9_000, { val: 90 }),
        makeSample('beta', 0 * BMS + 2_000, { val: 20 }),
        makeSample('beta', 0 * BMS + 8_000, { val: 80 }),
      ];

      const full = processLttb(samples, BSEC, 0 * BMS, 1 * BMS);
      const second = processLttb(samples, BSEC, 0 * BMS, 1 * BMS);
      expect(JSON.stringify(full)).toBe(JSON.stringify(second));

      // Result must be sorted by (timestamp ASC, sampleType ASC).
      const timestamps = full.map((s) => s['timestamp'] as number);
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));

      // Within the same timestamp, sampleType must be sorted lexicographically.
      const sameTs = full.filter(
        (s) => s['timestamp'] === 0 * BMS + BSEC * 500,
      );
      const sameTypes = sameTs.map((s) => s['sampleType'] as string);
      expect(sameTypes).toEqual([...sameTypes].sort());
    });

    it('multiple sampleTypes across multiple windows tile byte-equal', () => {
      const samples = [
        // bucket 0
        makeSample('alpha', 0 * BMS + 1_000, { a: 1, z: 100 }),
        makeSample('alpha', 0 * BMS + 5_000, { a: 50, z: 500 }),
        makeSample('alpha', 0 * BMS + 9_000, { a: 9, z: 900 }),
        makeSample('beta', 0 * BMS + 3_000, { b: 3 }),
        makeSample('beta', 0 * BMS + 7_000, { b: 77 }),
        // bucket 1
        makeSample('alpha', 1 * BMS + 500, { a: 2, z: 200 }),
        makeSample('beta', 1 * BMS + 5_000, { b: 5 }),
      ];

      const full = processLttb(samples, BSEC, 0, 2 * BMS);
      const w0 = processLttb(samples, BSEC, 0 * BMS, 1 * BMS);
      const w1 = processLttb(samples, BSEC, 1 * BMS, 2 * BMS);
      const tiled = [...w0, ...w1];

      expect(JSON.stringify(tiled)).toBe(JSON.stringify(full));
    });
  });

  describe('lttb: determinism', () => {
    it('shuffled input samples produce identical output', () => {
      const samples = [
        makeSample('motion', 0 * BMS + 1_000, { x: 10 }),
        makeSample('motion', 0 * BMS + 3_000, { x: 80 }),
        makeSample('motion', 0 * BMS + 5_000, { x: 15 }),
        makeSample('motion', 0 * BMS + 7_000, { x: 12 }),
        makeSample('motion', 0 * BMS + 9_000, { x: 11 }),
      ];

      // Shuffled: reverse order
      const shuffled = [...samples].reverse();

      const result1 = JSON.stringify(processLttb(samples, BSEC));
      const result2 = JSON.stringify(processLttb(shuffled, BSEC));

      expect(result1).toBe(result2);
    });

    it('data object field keys are in sorted order', () => {
      const samples = [makeSample('sensor', 5_000, { z: 3, m: 2, a: 1 })];
      const [entry] = processLttb(samples, BSEC) as Array<{
        timestamp: number;
        data: Record<string, number>;
      }>;

      const keys = Object.keys(entry.data);
      expect(keys).toEqual([...keys].sort());
    });
  });

  describe('lttb: spike preservation vs avg', () => {
    it('selects the interior spike value while avg flattens it', () => {
      // Bucket with a clear interior spike:
      // A=(0ms, 10), interior=(3000ms, 100), (7000ms, 10), C=(9000ms, 10)
      // Triangle area for the spike: |(9000)*(100-10) - (3000)*(10-10)| = 810000 (max)
      // LTTB picks value 100; avg = (10+100+10+10)/4 = 32.5
      const samples = [
        makeSample('hr', 0 * BMS + 0, { bpm: 10 }),
        makeSample('hr', 0 * BMS + 3_000, { bpm: 100 }),
        makeSample('hr', 0 * BMS + 7_000, { bpm: 10 }),
        makeSample('hr', 0 * BMS + 9_000, { bpm: 10 }),
      ];

      const lttbResult = processLttb(samples, BSEC) as Array<{
        timestamp: number;
        data: { bpm: number };
      }>;
      const avgResult = processAvg(samples, BSEC) as Array<{
        timestamp: number;
        data: { bpm: number };
      }>;

      expect(lttbResult).toHaveLength(1);
      expect(avgResult).toHaveLength(1);

      // LTTB keeps the spike
      expect(lttbResult[0].data.bpm).toBe(100);
      // avg flattens it
      expect(avgResult[0].data.bpm).toBeCloseTo(32.5, 5);
      // Timestamps are both at the bucket midpoint
      expect(lttbResult[0].timestamp).toBe(0 * BMS + BSEC * 500);
      expect(avgResult[0].timestamp).toBe(0 * BMS + BSEC * 500);
    });
  });

  describe('lttb: edge cases', () => {
    it('single-point bucket emits one record with that value', () => {
      const samples = [makeSample('hr', 5_000, { bpm: 60 })];
      const result = processLttb(samples, BSEC) as Array<{
        timestamp: number;
        sampleType: string;
        data: { bpm: number };
      }>;

      expect(result).toHaveLength(1);
      expect(result[0].data.bpm).toBe(60);
      expect(result[0].timestamp).toBe(0 * BMS + BSEC * 500); // midpoint
      expect(result[0].sampleType).toBe('hr');
    });

    it('two-point bucket — area is 0 for both endpoints, fallback picks by max deviation from mean', () => {
      // A=(1000ms, 10), C=(9000ms, 20) — both sit on the chord, area = 0 for both.
      // Fallback: mean = 15, dev(A) = 5, dev(C) = 5 — tied → first in sort order (A) wins.
      const samples = [
        makeSample('sensor', 0 * BMS + 1_000, { val: 10 }),
        makeSample('sensor', 0 * BMS + 9_000, { val: 20 }),
      ];

      const result = processLttb(samples, BSEC) as Array<{
        data: { val: number };
      }>;

      expect(result).toHaveLength(1);
      // Tiebreak by earliest ts → A (val=10) wins
      expect(result[0].data.val).toBe(10);
    });

    it('three collinear points — all areas zero, fallback picks endpoint with largest deviation', () => {
      // A=(1000ms, 2), B=(5000ms, 6), C=(9000ms, 10).
      // Verify collinearity: line from A to C at x=5000:
      //   y = 2 + (10-2)*(5000-1000)/(9000-1000) = 2 + 8*4000/8000 = 6 ✓
      // Area for B=(5000,6) vs chord A–C:
      //   |(9000-1000)*(6-2) - (5000-1000)*(10-2)| = |8000*4 - 4000*8| = |32000-32000| = 0 ✓
      // All areas 0 → fallback: mean=(2+6+10)/3=6, devs: |2-6|=4, |6-6|=0, |10-6|=4.
      // Tied at 4: A and C. Tiebreak by sort order → A (ts=1000, val=2) wins.
      const samplesCollinear = [
        makeSample('sensor', 0 * BMS + 1_000, { val: 2 }),
        makeSample('sensor', 0 * BMS + 5_000, { val: 6 }),
        makeSample('sensor', 0 * BMS + 9_000, { val: 10 }),
      ];

      const result = processLttb(samplesCollinear, BSEC) as Array<{
        data: { val: number };
      }>;
      expect(result).toHaveLength(1);
      // Collinear — all areas 0. Tied fallback devs → first in sort order (val=2) wins.
      expect(result[0].data.val).toBe(2);
    });

    it('empty window produces no output', () => {
      const samples = [makeSample('motion', 5_000, { x: 1 })];
      // Window [BMS, 2*BMS) does not contain the sample at 5000ms (bucket 0)
      const result = processLttb(samples, BSEC, 1 * BMS, 2 * BMS);
      expect(result).toHaveLength(0);
    });
  });
});
