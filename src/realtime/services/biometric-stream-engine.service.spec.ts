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
