import {
  aggregateRawSamples,
  reshapeAggregateRows,
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
 * Aggregate then reshape the given raw samples for a specific [fromMs, toMs) window.
 * This is the same two-step path production uses (aggregateBiometrics → reshapeAggregatedBiometrics).
 */
function process(
  samples: Record<string, unknown>[],
  bucketSec: number,
  fromMs?: number,
  toMs?: number,
  garbageBoundMs?: number,
): Record<string, unknown>[] {
  const rows = aggregateRawSamples(samples, bucketSec, fromMs, toMs, garbageBoundMs);
  return reshapeAggregateRows(rows, bucketSec);
}

// ─── constants ────────────────────────────────────────────────────────────────

// Keep these two in sync: BMS = BSEC * 1000.
const BSEC = 10;          // bucketSec argument  (seconds)
const BMS = BSEC * 1000;  // bucket width in ms  (= 10 000 ms)

// ─── tests ────────────────────────────────────────────────────────────────────

describe('biometric-aggregation.util', () => {
  describe('tiling: full-session equals N adjacent windows', () => {
    it('single sampleType — 3 windows tile a full session', () => {
      const samples = [
        makeSample('motion', 0 * BMS + 1_000, { x: 1, y: 10 }),  // bucket 0
        makeSample('motion', 0 * BMS + 5_000, { x: 3, y: 20 }),  // bucket 0
        makeSample('motion', 1 * BMS + 2_000, { x: 5, y: 30 }),  // bucket 1
        makeSample('motion', 2 * BMS + 8_000, { x: 7, y: 40 }),  // bucket 2
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
        makeSample('beta',  0 * BMS + 2_000, { val: 20 }),
        makeSample('beta',  0 * BMS + 8_000, { val: 80 }),
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
        makeSample('beta',  0 * BMS + 3_000, { b: 3 }),
        makeSample('beta',  0 * BMS + 7_000, { b: 77 }),
        // bucket 1
        makeSample('alpha', 1 * BMS + 500,   { a: 2, z: 200 }),
        makeSample('beta',  1 * BMS + 5_000, { b: 5 }),
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
        makeSample('motion', 0 * BMS + 5_000, { x: 1 }),  // bucket 0
        makeSample('motion', 1 * BMS,           { x: 2 }), // exactly at boundary → bucket 1
        makeSample('motion', 1 * BMS + 5_000,  { x: 3 }),  // bucket 1
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
        makeSample('motion', 0 * BMS + 5_000, { x: 5 }),   // bucket 0 (only in wide)
        makeSample('motion', 1 * BMS + 5_000, { x: 15 }),  // bucket 1 (shared)
        makeSample('motion', 2 * BMS + 5_000, { x: 25 }),  // bucket 2 (shared)
        makeSample('motion', 3 * BMS + 5_000, { x: 35 }),  // bucket 3 (only in wide)
      ];

      const narrow = process(samples, BSEC, 1 * BMS, 3 * BMS); // buckets 1, 2
      const wide   = process(samples, BSEC, 0 * BMS, 4 * BMS); // buckets 0, 1, 2, 3

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
      expect(minEntry.timestamp).toBe(0);          // bucket 0 start
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
        makeSample('beta',  0 * BMS + 2_000, { val: 20 }),
      ];
      const first  = JSON.stringify(process(samples, BSEC));
      const second = JSON.stringify(process(samples, BSEC));
      expect(first).toBe(second);
    });
  });
});
