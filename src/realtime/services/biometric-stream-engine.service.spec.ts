import { BiometricStreamEngine } from './biometric-stream-engine.service';
import { BioSessionSample } from '../entities/bio-session-sample.entity';
import { BioSampleInternal } from '../interfaces/bio-session-buffer.interface';
import { RealtimeConfig } from '../constants/realtime-config';

function makeRepo() {
  return {
    create: jest.fn((entity: Partial<BioSessionSample>) => entity),
    save: jest.fn(),
  };
}

function makeModuleSessionRepo() {
  return {
    update: jest.fn().mockResolvedValue(undefined),
  };
}

function makeConfig(overrides: Record<string, number> = {}) {
  const defaults: Record<string, number> = {
    [RealtimeConfig.BIO_STREAM_MAX_BUFFER_BYTES]: 1000,
    [RealtimeConfig.BIO_STREAM_MAX_SESSIONS]: 3,
    [RealtimeConfig.BIO_BACKPRESSURE_SAMPLES_PER_SEC]: 50,
  };
  const values = { ...defaults, ...overrides };
  return {
    get: jest.fn(<T>(key: string, fallback: T): T => {
      return (key in values ? values[key] : fallback) as T;
    }),
  };
}

function makeBioSample(
  sampleType = 'cardio',
  timestamp = 1000,
): BioSampleInternal {
  return { timestamp, sampleType, data: {} };
}

describe('BiometricStreamEngine', () => {
  let engine: BiometricStreamEngine;
  let repo: ReturnType<typeof makeRepo>;
  let moduleSessionRepo: ReturnType<typeof makeModuleSessionRepo>;
  let config: ReturnType<typeof makeConfig>;

  beforeEach(() => {
    jest.useFakeTimers();
    repo = makeRepo();
    moduleSessionRepo = makeModuleSessionRepo();
    config = makeConfig();
    engine = new BiometricStreamEngine(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      repo as any,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      moduleSessionRepo as any,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      config as any,
    );
  });

  afterEach(() => {
    void engine.onApplicationShutdown();
    jest.useRealTimers();
  });

  describe('pushBatch', () => {
    it('accepts samples and increments totalReceived', () => {
      const result = engine.pushBatch('s1', [makeBioSample(), makeBioSample()]);

      expect(result.acceptedCount).toBe(2);
      expect(result.droppedCount).toBe(0);
      expect(result.totalReceived).toBe(2);
    });

    it('drops samples when per-session byte cap is reached', () => {
      const bigSample: BioSampleInternal = {
        timestamp: 1,
        sampleType: 'cardio',
        data: 'x'.repeat(950),
      };
      engine.pushBatch('s1', [bigSample]);

      const result = engine.pushBatch('s1', [makeBioSample('overflow')]);

      expect(result.acceptedCount).toBe(0);
      expect(result.droppedCount).toBe(1);
      expect(result.totalDropped).toBe(1);
    });

    it('rejects all samples when session count cap is reached (new session)', () => {
      engine.pushBatch('s1', [makeBioSample()]);
      engine.pushBatch('s2', [makeBioSample()]);
      engine.pushBatch('s3', [makeBioSample()]);

      const result = engine.pushBatch('s4', [makeBioSample()]);

      expect(result.acceptedCount).toBe(0);
      expect(result.droppedCount).toBe(1);
      expect(result.totalReceived).toBe(0);
    });

    it('accepts push to an existing session even when session cap is full', () => {
      engine.pushBatch('s1', [makeBioSample()]);
      engine.pushBatch('s2', [makeBioSample()]);
      engine.pushBatch('s3', [makeBioSample()]);

      const result = engine.pushBatch('s1', [makeBioSample()]);

      expect(result.acceptedCount).toBe(1);
    });

    it('accumulates totalReceived across pushBatch calls', () => {
      engine.pushBatch('s1', [makeBioSample()]);
      engine.pushBatch('s1', [makeBioSample()]);
      const result = engine.pushBatch('s1', [makeBioSample()]);

      expect(result.totalReceived).toBe(3);
    });
  });

  describe('flush', () => {
    it('saves batch to DB and clears buffer', async () => {
      repo.save.mockResolvedValue({});
      engine.pushBatch('s1', [makeBioSample(), makeBioSample()]);

      await engine.flush('s1');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          moduleSessionId: 's1',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          samples: expect.arrayContaining([expect.any(Object)]),
        }),
      );
      expect(repo.save).toHaveBeenCalledTimes(1);

      // Buffer cleared — second flush should be no-op
      repo.save.mockClear();
      await engine.flush('s1');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('is a no-op when buffer is empty', async () => {
      await engine.flush('unknown-session');

      expect(repo.save).not.toHaveBeenCalled();
    });

    it('preserves buffer on DB error', async () => {
      repo.save.mockRejectedValue(new Error('DB down'));
      engine.pushBatch('s1', [makeBioSample(), makeBioSample()]);

      await expect(engine.flush('s1')).rejects.toThrow('DB down');

      // Buffer must still contain the 2 samples
      const result = engine.pushBatch('s1', [makeBioSample()]);
      expect(result.totalReceived).toBe(3);
    });

    it('does not reset cumulative counters on flush', async () => {
      repo.save.mockResolvedValue({});
      engine.pushBatch('s1', [makeBioSample(), makeBioSample()]);

      await engine.flush('s1');

      const result = engine.pushBatch('s1', [makeBioSample()]);
      // totalReceived should accumulate across flushes, not reset
      expect(result.totalReceived).toBe(3);
    });

    it('updates lastActivityAt on successful flush', async () => {
      repo.save.mockResolvedValue({});
      engine.pushBatch('s1', [makeBioSample()]);

      await engine.flush('s1');
      // Drain microtask queue so the fire-and-forget .catch chain resolves
      await Promise.resolve();

      expect(moduleSessionRepo.update).toHaveBeenCalledWith(
        { id: 's1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        { lastActivityAt: expect.any(Date) },
      );
    });
  });

  describe('flushAll', () => {
    it('flushes all buffered sessions', async () => {
      repo.save.mockResolvedValue({});
      engine.pushBatch('s1', [makeBioSample()]);
      engine.pushBatch('s2', [makeBioSample()]);

      await engine.flushAll();

      expect(repo.save).toHaveBeenCalledTimes(2);
    });

    it('continues flushing remaining sessions after one fails', async () => {
      repo.save
        .mockRejectedValueOnce(new Error('DB down'))
        .mockResolvedValue({});
      engine.pushBatch('s1', [makeBioSample()]);
      engine.pushBatch('s2', [makeBioSample()]);

      await expect(engine.flushAll()).resolves.not.toThrow();

      expect(repo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('periodic flush', () => {
    it('flushAll is called every 5 seconds after bootstrap', async () => {
      repo.save.mockResolvedValue({});
      engine.pushBatch('s1', [makeBioSample()]);

      engine.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(5000);

      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('lifecycle events', () => {
    it('onSessionCompleted flushes and removes buffer', async () => {
      repo.save.mockResolvedValue({});
      engine.pushBatch('s1', [makeBioSample()]);

      await engine.onSessionCompleted({ sessionId: 's1' });

      expect(repo.save).toHaveBeenCalledTimes(1);
      repo.save.mockClear();
      await engine.flush('s1');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('onSessionAbandoned flushes and removes buffer', async () => {
      repo.save.mockResolvedValue({});
      engine.pushBatch('s1', [makeBioSample()]);

      await engine.onSessionAbandoned({ sessionId: 's1' });

      expect(repo.save).toHaveBeenCalledTimes(1);
      repo.save.mockClear();
      await engine.flush('s1');
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('root ABANDONED — flush coexistence', () => {
    // Characterization / invariant (GREEN now, must stay GREEN through spec 07).
    // The bio engine subscribes to ABANDONED independently of StatsWorker and flushes via
    // { sessionId } payload — the stats guard must touch only the StatsWorker path.
    // If this goes RED after spec 07, the guard wrongly reached into the bio path → Class-B → escalate.
    it('should still flush the bio buffer on a root ABANDONED — invariant guarding spec 07 against over-guard', async () => {
      const flushSpy = jest.spyOn(engine, 'flush').mockResolvedValue(undefined);
      await engine.onSessionAbandoned({ sessionId: 'root-1' });
      expect(flushSpy).toHaveBeenCalledWith('root-1');
    });
  });

  // ── Per-root lifecycle flush (characterization — must stay GREEN) ────────────
  // P4: the engine buffers per-id and flushes per-id already; passing root.id in
  // spec 10 makes bio per-root automatically. These cases guard spec 10/04 against
  // breaking that id-agnostic flush without having to change the engine at all.

  describe('root lifecycle flush (characterization — must stay GREEN)', () => {
    it('[characterization — must stay GREEN] flushes and clears the per-root buffer on root ABANDONED', async () => {
      repo.save.mockResolvedValue({});
      engine.pushBatch('root-1', [makeBioSample()]);

      await engine.onSessionAbandoned({ sessionId: 'root-1' });

      // Real save + clear: repo.save called exactly once for the flush
      expect(repo.save).toHaveBeenCalledTimes(1);

      // Buffer cleared: a follow-up flush must be a no-op
      repo.save.mockClear();
      await engine.flush('root-1');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('[characterization — must stay GREEN] flushes and clears the per-root buffer on REVOKED', async () => {
      repo.save.mockResolvedValue({});
      engine.pushBatch('root-1', [makeBioSample()]);

      await engine.onSessionRevoked({ sessionId: 'root-1' });

      expect(repo.save).toHaveBeenCalledTimes(1);

      // Buffer cleared
      repo.save.mockClear();
      await engine.flush('root-1');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('[characterization — must stay GREEN] child COMPLETED is a harmless no-op when the child owns no buffer', async () => {
      repo.save.mockResolvedValue({});
      // Only root-1 has a buffer — child-9 never owned bio data
      engine.pushBatch('root-1', [makeBioSample()]);

      await engine.onSessionCompleted({ sessionId: 'child-9' });

      // No save should have happened (child-9 had no buffer)
      expect(repo.save).not.toHaveBeenCalled();

      // root-1 buffer is still intact — a later flush still persists it
      await engine.flush('root-1');
      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  // ── Overflow temporal density (characterization — must stay GREEN) ────────────
  // P4 / L1: overflow increments dropped_count without breaking temporal density —
  // the continue-not-break guarantee (engine :113-119). Assert via returned counters
  // only, never via buffer.byteSize or buffer.samples.

  describe('overflow temporal density (characterization — must stay GREEN)', () => {
    it('[characterization — must stay GREEN] dropping a mid-batch oversized sample preserves its neighbours', () => {
      // config: 1000-byte cap per buffer. Two small samples + one large.
      // First push fills ~half the budget.
      engine.pushBatch('root-1', [makeBioSample('cardio', 1)]); // accepted, small

      // Build an oversized sample that exceeds the remaining budget
      // (BIO_STREAM_MAX_BUFFER_BYTES = 1000 from makeConfig default)
      const oversized: BioSampleInternal = {
        timestamp: 2,
        sampleType: 'nfb',
        data: 'x'.repeat(950), // pushes byteSize well past 1000
      };
      const small: BioSampleInternal = {
        timestamp: 3,
        sampleType: 'emotions',
        data: {},
      };

      // Send [oversized, small] in one batch; oversized must be dropped,
      // small must be accepted (continue, not break)
      const result = engine.pushBatch('root-1', [oversized, small]);

      // L1 — assert outcome counters only
      expect(result.acceptedCount).toBe(1); // small accepted
      expect(result.droppedCount).toBe(1); // oversized dropped
    });
  });

  describe('maxSamplesPerSecond', () => {
    it('returns value from config', () => {
      expect(engine.maxSamplesPerSecond).toBe(50);
    });
  });

  describe('flush concurrency / correctness', () => {
    it('no duplicate — overlapping flush does not re-persist already-pending samples', async () => {
      let resolveFirst!: () => void;
      const firstSave = new Promise<void>((res) => {
        resolveFirst = res;
      });
      repo.save.mockReturnValueOnce(firstSave).mockResolvedValue({});

      engine.pushBatch('s1', [makeBioSample('cardio', 1)]);
      engine.pushBatch('s1', [makeBioSample('cardio', 2)]);

      const flush1 = engine.flush('s1'); // hangs mid-save holding [s1, s2]
      const flush2 = engine.flush('s1'); // chains after flush1

      resolveFirst(); // flush1 save resolves → splice(0, 2), buffer empty
      await Promise.all([flush1, flush2]);

      // flush1 saved 2 samples; flush2 found empty buffer → no second save
      expect(repo.save).toHaveBeenCalledTimes(1);

      const saved = repo.create.mock.calls[0][0] as {
        samples: BioSampleInternal[];
      };
      expect(saved.samples).toHaveLength(2);
    });

    it('no tail loss — sample pushed during await save is persisted in chained flush', async () => {
      let resolveFirst!: () => void;
      const firstSave = new Promise<void>((res) => {
        resolveFirst = res;
      });
      repo.save.mockReturnValueOnce(firstSave).mockResolvedValue({});

      engine.pushBatch('s1', [makeBioSample('cardio', 1)]);
      engine.pushBatch('s1', [makeBioSample('cardio', 2)]);

      const flush1 = engine.flush('s1'); // schedules doFlush, not yet running

      // Drain 2 microtask ticks: (1) prior resolves, (2) doFlush starts and hangs at await save
      await Promise.resolve();
      await Promise.resolve();

      // Push a tail sample while doFlush is suspended at await sampleRepo.save
      engine.pushBatch('s1', [makeBioSample('nfb', 3)]);

      const flush2 = engine.flush('s1'); // chains after flush1, will see [nfb]

      resolveFirst(); // flush1 resolves → splice(0, 2), buffer = [nfb], byteSize recomputed
      await Promise.all([flush1, flush2]);

      // flush1 saved 2 samples; flush2 saved [nfb]
      expect(repo.save).toHaveBeenCalledTimes(2);

      const secondBatch = repo.create.mock.calls[1][0] as {
        samples: BioSampleInternal[];
      };
      expect(secondBatch.samples).toHaveLength(1);
      expect(secondBatch.samples[0].sampleType).toBe('nfb');
    });

    it('terminal flush after periodic persists the completion tail', async () => {
      let resolveFirst!: () => void;
      const firstSave = new Promise<void>((res) => {
        resolveFirst = res;
      });
      repo.save.mockReturnValueOnce(firstSave).mockResolvedValue({});

      engine.pushBatch('s1', [makeBioSample('cardio', 1)]);
      const periodicFlush = engine.flush('s1'); // schedules doFlush, not yet running

      // Drain 2 microtask ticks: (1) prior resolves, (2) doFlush starts and hangs at await save
      await Promise.resolve();
      await Promise.resolve();

      // Push tail sample while doFlush is suspended at await sampleRepo.save
      engine.pushBatch('s1', [makeBioSample('emotions', 2)]);

      // Terminal handler chains its flush after the in-flight periodic flush
      const terminalDone = engine.onSessionCompleted({ sessionId: 's1' });

      resolveFirst(); // periodic flush resolves → splice(0, 1), buffer = [emotions]
      await Promise.all([periodicFlush, terminalDone]);

      // periodic flush saved [cardio]; terminal flush saved [emotions]
      expect(repo.save).toHaveBeenCalledTimes(2);

      const secondBatch = repo.create.mock.calls[1][0] as {
        samples: BioSampleInternal[];
      };
      expect(secondBatch.samples).toHaveLength(1);
      expect(secondBatch.samples[0].sampleType).toBe('emotions');

      // Buffer deleted after terminal flush — next flush is a no-op
      repo.save.mockClear();
      await engine.flush('s1');
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
