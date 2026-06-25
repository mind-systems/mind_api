import { FindOperator } from 'typeorm';
import { SessionWatchdogService } from './session-watchdog.service';
import { SessionStatus } from '../enums/session-status.enum';
import { ActivityType } from '../enums/activity-type.enum';
import { ModuleSession } from '../entities/module-session.entity';

const FIXED_NOW = 1_700_000_000_000;

function makeSession(
  overrides: Partial<Pick<ModuleSession, 'id' | 'userId' | 'status' | 'lastActivityAt'>> = {},
): ModuleSession {
  return {
    id: `session-${Math.random()}`,
    userId: `user-${Math.random()}`,
    activityType: ActivityType.BREATH,
    status: SessionStatus.ACTIVE,
    startedAt: new Date(FIXED_NOW - 700_000),
    lastActivityAt: new Date(FIXED_NOW - 700_000),
    createdAt: new Date(FIXED_NOW - 700_000),
    ...overrides,
  } as ModuleSession;
}

describe('SessionWatchdogService', () => {
  let service: SessionWatchdogService;
  let repo: { find: jest.Mock };
  let activityEngine: { abandonStale: jest.Mock };
  let activeStreamRegistry: { hasLiveSubscriber: jest.Mock; closeAll: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    repo = { find: jest.fn() };
    activityEngine = { abandonStale: jest.fn().mockResolvedValue(undefined) };
    activeStreamRegistry = {
      hasLiveSubscriber: jest.fn().mockReturnValue(false),
      closeAll: jest.fn(),
    };
    configService = { get: jest.fn((_key: string, def: unknown) => def) };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    service = new SessionWatchdogService(
      repo as any,
      activityEngine as any,
      activeStreamRegistry as any,
      configService as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sweep — query construction and empty result', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
      repo.find.mockResolvedValue([]);
    });

    it('should query repo.find with status In([ACTIVE, DISCONNECTED]) and lastActivityAt LessThan(threshold)', async () => {
      await service.sweep();

      expect(repo.find).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const [callArg] = repo.find.mock.calls[0] as [any];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const status: unknown = callArg.where.status;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const lastActivityAt: unknown = callArg.where.lastActivityAt;

      expect(status).toBeInstanceOf(FindOperator);
      expect((status as any).value).toEqual(
        expect.arrayContaining([SessionStatus.ACTIVE, SessionStatus.DISCONNECTED]),
      );

      const expectedThreshold = new Date(FIXED_NOW - 600_000);
      expect(lastActivityAt).toBeInstanceOf(FindOperator);
      expect((lastActivityAt as any).value).toEqual(expectedThreshold);
    });

    it('should compute the threshold from a custom WS_SESSION_MAX_IDLE_MS when configured', async () => {
      const customIdleMs = 120_000;
      const customConfigService = {
        get: jest.fn((key: string, def: unknown) =>
          key === 'WS_SESSION_MAX_IDLE_MS' ? customIdleMs : def,
        ),
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const customService = new SessionWatchdogService(
        repo as any,
        activityEngine as any,
        activeStreamRegistry as any,
        customConfigService as any,
      );

      await customService.sweep();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const [callArg] = repo.find.mock.calls[0] as [any];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const lastActivityAt: unknown = callArg.where.lastActivityAt;
      const expectedThreshold = new Date(FIXED_NOW - customIdleMs);
      expect((lastActivityAt as any).value).toEqual(expectedThreshold);
    });

    it('should return early and not call activityEngine.abandonStale or activeStreamRegistry methods when repo.find resolves to an empty array', async () => {
      await service.sweep();

      expect(activityEngine.abandonStale).not.toHaveBeenCalled();
      expect(activeStreamRegistry.hasLiveSubscriber).not.toHaveBeenCalled();
      expect(activeStreamRegistry.closeAll).not.toHaveBeenCalled();
    });
  });

  describe('sweep — reaping behavior', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    });

    it('should call activityEngine.abandonStale(userId, id) for each stale session', async () => {
      const session = makeSession({ userId: 'user-a', id: 'session-a' });
      repo.find.mockResolvedValue([session]);

      await service.sweep();

      expect(activityEngine.abandonStale).toHaveBeenCalledTimes(1);
      expect(activityEngine.abandonStale).toHaveBeenCalledWith('user-a', 'session-a');
    });

    it('should call activeStreamRegistry.closeAll(userId) after abandonStale for a reaped session', async () => {
      const session = makeSession({ userId: 'user-a', id: 'session-a' });
      repo.find.mockResolvedValue([session]);

      await service.sweep();

      expect(activeStreamRegistry.closeAll).toHaveBeenCalledWith('user-a');
    });

    it('should reap every stale session when multiple rows are returned', async () => {
      const session1 = makeSession({ userId: 'user-a', id: 'session-a' });
      const session2 = makeSession({ userId: 'user-b', id: 'session-b' });
      repo.find.mockResolvedValue([session1, session2]);

      await service.sweep();

      expect(activityEngine.abandonStale).toHaveBeenCalledTimes(2);
      expect(activityEngine.abandonStale).toHaveBeenCalledWith('user-a', 'session-a');
      expect(activityEngine.abandonStale).toHaveBeenCalledWith('user-b', 'session-b');
      expect(activeStreamRegistry.closeAll).toHaveBeenCalledTimes(2);
      expect(activeStreamRegistry.closeAll).toHaveBeenCalledWith('user-a');
      expect(activeStreamRegistry.closeAll).toHaveBeenCalledWith('user-b');
    });

    it('should check hasLiveSubscriber before reaping each session', async () => {
      const session1 = makeSession({ userId: 'user-a' });
      const session2 = makeSession({ userId: 'user-b' });
      repo.find.mockResolvedValue([session1, session2]);

      await service.sweep();

      expect(activeStreamRegistry.hasLiveSubscriber).toHaveBeenCalledTimes(2);
      expect(activeStreamRegistry.hasLiveSubscriber).toHaveBeenCalledWith('user-a');
      expect(activeStreamRegistry.hasLiveSubscriber).toHaveBeenCalledWith('user-b');
    });
  });

  describe('sweep — live-subscriber skip path', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    });

    it('should skip a session and not call abandonStale or closeAll when hasLiveSubscriber returns true for that userId', async () => {
      const session = makeSession({ userId: 'user-a' });
      repo.find.mockResolvedValue([session]);
      activeStreamRegistry.hasLiveSubscriber.mockReturnValue(true);

      await service.sweep();

      expect(activityEngine.abandonStale).not.toHaveBeenCalled();
      expect(activeStreamRegistry.closeAll).not.toHaveBeenCalled();
    });

    it('should reap only the rows without a live subscriber when a mix of rows is returned', async () => {
      const sessionA = makeSession({ userId: 'user-a', id: 'session-a' });
      const sessionB = makeSession({ userId: 'user-b', id: 'session-b' });
      repo.find.mockResolvedValue([sessionA, sessionB]);
      activeStreamRegistry.hasLiveSubscriber.mockImplementation(
        (userId: string) => userId === 'user-a',
      );

      await service.sweep();

      expect(activityEngine.abandonStale).toHaveBeenCalledTimes(1);
      expect(activityEngine.abandonStale).toHaveBeenCalledWith('user-b', 'session-b');
      expect(activityEngine.abandonStale).not.toHaveBeenCalledWith('user-a', expect.anything());
      expect(activeStreamRegistry.closeAll).toHaveBeenCalledTimes(1);
      expect(activeStreamRegistry.closeAll).toHaveBeenCalledWith('user-b');
    });
  });

  describe('sweep — per-row error isolation', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    });

    it('should continue reaping remaining sessions when abandonStale rejects for one row', async () => {
      const session1 = makeSession({ userId: 'user-a', id: 'session-a' });
      const session2 = makeSession({ userId: 'user-b', id: 'session-b' });
      repo.find.mockResolvedValue([session1, session2]);
      activityEngine.abandonStale
        .mockRejectedValueOnce(new Error('engine error'))
        .mockResolvedValueOnce(undefined);

      await expect(service.sweep()).resolves.toBeUndefined();

      expect(activityEngine.abandonStale).toHaveBeenCalledTimes(2);
      expect(activityEngine.abandonStale).toHaveBeenCalledWith('user-b', 'session-b');
    });

    it('should not call closeAll for a row whose abandonStale rejected', async () => {
      const session1 = makeSession({ userId: 'user-a', id: 'session-a' });
      const session2 = makeSession({ userId: 'user-b', id: 'session-b' });
      repo.find.mockResolvedValue([session1, session2]);
      activityEngine.abandonStale
        .mockRejectedValueOnce(new Error('engine error'))
        .mockResolvedValueOnce(undefined);

      await service.sweep();

      expect(activeStreamRegistry.closeAll).not.toHaveBeenCalledWith('user-a');
      expect(activeStreamRegistry.closeAll).toHaveBeenCalledWith('user-b');
    });

    it('should resolve (not reject) when every row fails to reap', async () => {
      const session1 = makeSession({ userId: 'user-a' });
      const session2 = makeSession({ userId: 'user-b' });
      repo.find.mockResolvedValue([session1, session2]);
      activityEngine.abandonStale.mockRejectedValue(new Error('engine error'));

      await expect(service.sweep()).resolves.toBeUndefined();
    });
  });

  describe('lifecycle — bootstrap and shutdown timer management', () => {
    it('should start a setInterval with the configured sweep interval on onApplicationBootstrap', () => {
      const setIntervalSpy = jest
        .spyOn(global, 'setInterval')
        .mockReturnValue(0 as unknown as ReturnType<typeof setInterval>);

      service.onApplicationBootstrap();

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    });

    it('should clear the sweep timer on onApplicationShutdown', async () => {
      const fakeTimer = 42 as unknown as ReturnType<typeof setInterval>;
      jest.spyOn(global, 'setInterval').mockReturnValue(fakeTimer);
      const clearIntervalSpy = jest
        .spyOn(global, 'clearInterval')
        .mockImplementation(() => undefined);

      service.onApplicationBootstrap();
      await service.onApplicationShutdown();

      expect(clearIntervalSpy).toHaveBeenCalledWith(fakeTimer);
    });

    it('should not call clearInterval on onApplicationShutdown when the timer was never started', async () => {
      const clearIntervalSpy = jest
        .spyOn(global, 'clearInterval')
        .mockImplementation(() => undefined);

      await service.onApplicationShutdown();

      expect(clearIntervalSpy).not.toHaveBeenCalled();
    });

    it('should invoke sweep when the interval callback fires', () => {
      let capturedCallback: (() => void) | undefined;
      jest.spyOn(global, 'setInterval').mockImplementation((cb: TimerHandler) => {
        capturedCallback = cb as () => void;
        return 0 as unknown as ReturnType<typeof setInterval>;
      });
      const sweepSpy = jest.spyOn(service, 'sweep').mockResolvedValue(undefined);

      service.onApplicationBootstrap();

      expect(capturedCallback).toBeDefined();
      capturedCallback!();

      expect(sweepSpy).toHaveBeenCalledTimes(1);
    });
  });
});
