import { StreamEngine } from './stream-engine.service';
import { SessionStreamSample } from '../entities/session-stream-sample.entity';
import { TelemetrySample } from '../interfaces/session-buffer.interface';
import { RealtimeConfig } from '../constants/realtime-config';

function makeRepo() {
  return {
    create: jest.fn((entity: Partial<SessionStreamSample>) => entity),
    save: jest.fn(),
  };
}

function makeLiveSessionRepo() {
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

function makeSample(data = 'x', timestamp = 1000): TelemetrySample {
  return { timestamp, data };
}

describe('StreamEngine', () => {
  let engine: StreamEngine;
  let repo: ReturnType<typeof makeRepo>;
  let liveSessionRepo: ReturnType<typeof makeLiveSessionRepo>;
  let config: ReturnType<typeof makeConfig>;

  beforeEach(() => {
    jest.useFakeTimers();
    repo = makeRepo();
    liveSessionRepo = makeLiveSessionRepo();
    config = makeConfig();
    engine = new StreamEngine(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      repo as any,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      liveSessionRepo as any,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      config as any,
    );
  });

  afterEach(() => {
    engine.onApplicationShutdown();
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
          liveSessionId: 's1',
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

      expect(liveSessionRepo.update).toHaveBeenCalledWith(
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
});
