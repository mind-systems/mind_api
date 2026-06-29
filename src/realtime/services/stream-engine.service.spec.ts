import { StreamEngine } from './stream-engine.service';
import { SessionStreamSample } from '../entities/session-stream-sample.entity';
import { InstructionSample } from '../interfaces/session-buffer.interface';
import { RealtimeConfig } from '../constants/realtime-config';
import { StreamDataType } from '../constants/stream-data-types';

function makeRepo() {
  return {
    create: jest.fn((entity: Partial<SessionStreamSample>) => entity),
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
    [RealtimeConfig.STREAM_MAX_BUFFER_BYTES]: 1000,
    [RealtimeConfig.STREAM_MAX_SESSIONS]: 3,
    [RealtimeConfig.BACKPRESSURE_SAMPLES_PER_SEC]: 50,
  };
  const values = { ...defaults, ...overrides };
  return {
    get: jest.fn(<T>(key: string, fallback: T): T => {
      return (key in values ? values[key] : fallback) as T;
    }),
  };
}

function makeSample(data = 'x', timestamp = 1000): InstructionSample {
  return { timestamp, data };
}

function makeMarkerSample(
  event = 'paused',
  timestamp = 1000,
): InstructionSample {
  return { timestamp, data: { dataType: StreamDataType.SESSION_EVENT, event } };
}

describe('StreamEngine', () => {
  let engine: StreamEngine;
  let repo: ReturnType<typeof makeRepo>;
  let moduleSessionRepo: ReturnType<typeof makeModuleSessionRepo>;
  let config: ReturnType<typeof makeConfig>;

  beforeEach(() => {
    jest.useFakeTimers();
    repo = makeRepo();
    moduleSessionRepo = makeModuleSessionRepo();
    config = makeConfig();
    engine = new StreamEngine(
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

  describe('push', () => {
    it('accepts sample and increments totalReceived', () => {
      const result = engine.push('s1', makeSample());

      expect(result.accepted).toBe(true);
      expect(result.droppedCount).toBe(0);
      expect(result.totalReceived).toBe(1);
    });

    it('rejects sample when per-session byte cap is reached', () => {
      // Fill buffer close to the cap (1000 bytes) with a large sample
      const bigSample = makeSample('x'.repeat(950));
      engine.push('s1', bigSample);

      const result = engine.push('s1', makeSample('overflow'));

      expect(result.accepted).toBe(false);
      expect(result.droppedCount).toBe(1);
    });

    it('rejects when session count cap is reached (new session)', () => {
      // Cap is 3 sessions
      engine.push('s1', makeSample());
      engine.push('s2', makeSample());
      engine.push('s3', makeSample());

      // 4th distinct session should be rejected
      const result = engine.push('s4', makeSample());

      expect(result.accepted).toBe(false);
      expect(result.droppedCount).toBe(1);
      expect(result.totalReceived).toBe(0);
    });

    it('accepts push to an existing session even when session cap is full', () => {
      engine.push('s1', makeSample());
      engine.push('s2', makeSample());
      engine.push('s3', makeSample());

      // Second push to existing session s1 — must succeed
      const result = engine.push('s1', makeSample());

      expect(result.accepted).toBe(true);
    });

    it('accumulates totalReceived across pushes', () => {
      engine.push('s1', makeSample());
      engine.push('s1', makeSample());
      const result = engine.push('s1', makeSample());

      expect(result.totalReceived).toBe(3);
    });
  });

  describe('flush', () => {
    it('saves batch to DB and clears buffer', async () => {
      repo.save.mockResolvedValue({});
      engine.push('s1', makeSample());
      engine.push('s1', makeSample());

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
      engine.push('s1', makeSample());
      engine.push('s1', makeSample());

      await expect(engine.flush('s1')).rejects.toThrow('DB down');

      // Buffer must still contain the 2 samples
      const result = engine.push('s1', makeSample());
      expect(result.totalReceived).toBe(3);
    });

    it('updates lastActivityAt on successful flush', async () => {
      repo.save.mockResolvedValue({});
      engine.push('s1', makeSample());

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
      engine.push('s1', makeSample());
      engine.push('s2', makeSample());

      await engine.flushAll();

      expect(repo.save).toHaveBeenCalledTimes(2);
    });

    it('continues flushing remaining sessions after one fails', async () => {
      repo.save
        .mockRejectedValueOnce(new Error('DB down'))
        .mockResolvedValue({});
      engine.push('s1', makeSample());
      engine.push('s2', makeSample());

      await expect(engine.flushAll()).resolves.not.toThrow();

      // s2 must still have been flushed
      expect(repo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('periodic flush', () => {
    it('flushAll is called every 5 seconds after bootstrap', async () => {
      repo.save.mockResolvedValue({});
      engine.push('s1', makeSample());

      engine.onApplicationBootstrap();
      // Advance by 5 s and drain pending microtasks after each timer tick
      await jest.advanceTimersByTimeAsync(5000);

      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('lifecycle events', () => {
    it('onSessionCompleted flushes and removes buffer', async () => {
      repo.save.mockResolvedValue({});
      engine.push('s1', makeSample());

      await engine.onSessionCompleted({ sessionId: 's1' });

      expect(repo.save).toHaveBeenCalledTimes(1);
      // Buffer deleted — flush again should be no-op
      repo.save.mockClear();
      await engine.flush('s1');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('onSessionAbandoned flushes and removes buffer', async () => {
      repo.save.mockResolvedValue({});
      engine.push('s1', makeSample());

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

  describe('immediate marker persistence', () => {
    it('single marker writes immediately (RED until spec 25-persist-ispaused)', () => {
      repo.save.mockResolvedValue({});
      engine.push('s1', makeMarkerSample('paused'));

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          moduleSessionId: 's1',
          samples: [makeMarkerSample('paused')],
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          flushedAt: expect.any(Date),
        }),
      );
      expect(repo.save).toHaveBeenCalled();
    });

    it('two distinct markers write two immediate one-element saves (RED until spec 25-persist-ispaused)', () => {
      repo.save.mockResolvedValue({});
      engine.push('s1', makeMarkerSample('paused'));
      engine.push('s1', makeMarkerSample('resumed'));

      expect(repo.save).toHaveBeenCalledTimes(2);
      expect(repo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ samples: [makeMarkerSample('paused')] }),
      );
      expect(repo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ samples: [makeMarkerSample('resumed')] }),
      );
    });

    it('breath_phase push does not write immediately — buffers until flush', async () => {
      repo.save.mockResolvedValue({});
      engine.push('s1', { timestamp: 1000, data: { phase: 'exhale' } });

      expect(repo.save).not.toHaveBeenCalled();

      await engine.flush('s1');
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('makeSample (string data) path is unchanged — buffered, saved only on flush', async () => {
      repo.save.mockResolvedValue({});
      engine.push('s1', makeSample());

      expect(repo.save).not.toHaveBeenCalled();

      await engine.flush('s1');
      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('flush concurrency / correctness', () => {
    it('no duplicate — overlapping flush does not re-persist already-pending samples', async () => {
      let resolveFirst!: () => void;
      const firstSave = new Promise<void>((res) => {
        resolveFirst = res;
      });
      repo.save.mockReturnValueOnce(firstSave).mockResolvedValue({});

      engine.push('s1', makeSample('a', 1));
      engine.push('s1', makeSample('b', 2));

      const flush1 = engine.flush('s1'); // hangs mid-save holding [a, b]
      const flush2 = engine.flush('s1'); // chains after flush1

      resolveFirst(); // flush1 save resolves → splice(0, 2), buffer empty
      await Promise.all([flush1, flush2]);

      // flush1 saved [a, b]; flush2 found empty buffer → no second save
      expect(repo.save).toHaveBeenCalledTimes(1);

      const saved = repo.create.mock.calls[0][0] as {
        samples: InstructionSample[];
      };
      expect(saved.samples).toHaveLength(2);
      expect(saved.samples.map((s) => s.data)).toEqual(['a', 'b']);
    });

    it('no tail loss — sample pushed during await save is persisted in chained flush', async () => {
      let resolveFirst!: () => void;
      const firstSave = new Promise<void>((res) => {
        resolveFirst = res;
      });
      repo.save.mockReturnValueOnce(firstSave).mockResolvedValue({});

      engine.push('s1', makeSample('a', 1));
      engine.push('s1', makeSample('b', 2));

      const flush1 = engine.flush('s1'); // schedules doFlush, not yet running

      // Drain 2 microtask ticks: (1) prior resolves, (2) doFlush starts and hangs at await save
      await Promise.resolve();
      await Promise.resolve();

      // Push a tail sample while doFlush is suspended at await sampleRepo.save
      engine.push('s1', makeSample('c', 3));

      const flush2 = engine.flush('s1'); // chains after flush1, will see [c]

      resolveFirst(); // flush1 resolves → splice(0, 2), buffer = [c], byteSize recomputed
      await Promise.all([flush1, flush2]);

      // flush1 saved [a, b]; flush2 saved [c]
      expect(repo.save).toHaveBeenCalledTimes(2);

      const secondBatch = repo.create.mock.calls[1][0] as {
        samples: InstructionSample[];
      };
      expect(secondBatch.samples).toHaveLength(1);
      expect(secondBatch.samples[0].data).toBe('c');
    });

    it('terminal flush after periodic persists the completion tail', async () => {
      let resolveFirst!: () => void;
      const firstSave = new Promise<void>((res) => {
        resolveFirst = res;
      });
      repo.save.mockReturnValueOnce(firstSave).mockResolvedValue({});

      engine.push('s1', makeSample('a', 1));
      const periodicFlush = engine.flush('s1'); // schedules doFlush, not yet running

      // Drain 2 microtask ticks: (1) prior resolves, (2) doFlush starts and hangs at await save
      await Promise.resolve();
      await Promise.resolve();

      // Push tail sample while doFlush is suspended at await sampleRepo.save
      engine.push('s1', makeSample('tail', 2));

      // Terminal handler chains its flush after the in-flight periodic flush
      const terminalDone = engine.onSessionCompleted({ sessionId: 's1' });

      resolveFirst(); // periodic flush resolves → splice(0, 1), buffer = [tail]
      await Promise.all([periodicFlush, terminalDone]);

      // periodic flush saved [a]; terminal flush saved [tail]
      expect(repo.save).toHaveBeenCalledTimes(2);

      const secondBatch = repo.create.mock.calls[1][0] as {
        samples: InstructionSample[];
      };
      expect(secondBatch.samples).toHaveLength(1);
      expect(secondBatch.samples[0].data).toBe('tail');

      // Buffer deleted after terminal flush — next flush is a no-op
      repo.save.mockClear();
      await engine.flush('s1');
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
