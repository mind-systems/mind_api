import { StatsWorker } from './stats.worker';
import { StatsService, SessionEvent } from './stats.service';
import { ActivityType } from '../realtime/enums/activity-type.enum';

function makeStatsService() {
  return {
    finalise: jest.fn().mockResolvedValue(undefined),
  } as unknown as StatsService;
}

function makeEvent(): SessionEvent {
  const now = new Date();
  return {
    sessionId: 'sess-1',
    userId: 'user-1',
    startedAt: new Date(now.getTime() - 30_000),
    endedAt: now,
    activityType: ActivityType.BREATH,
  };
}

describe('StatsWorker', () => {
  let worker: StatsWorker;
  let statsService: StatsService;

  beforeEach(() => {
    statsService = makeStatsService();
    worker = new StatsWorker(statsService);
  });

  it('calls finalise with correct payload on session.completed', async () => {
    const event = makeEvent();
    await worker.onSessionCompleted(event);
    expect(statsService.finalise).toHaveBeenCalledTimes(1);
    expect(statsService.finalise).toHaveBeenCalledWith(event);
  });

  it('calls finalise with correct payload on session.abandoned', async () => {
    const event = makeEvent();
    await worker.onSessionAbandoned(event);
    expect(statsService.finalise).toHaveBeenCalledTimes(1);
    expect(statsService.finalise).toHaveBeenCalledWith(event);
  });

  it('should call finalise once with the event when session.interrupted is handled', async () => {
    const event = makeEvent();
    await worker.onSessionInterrupted(event);
    expect(statsService.finalise).toHaveBeenCalledTimes(1);
    expect(statsService.finalise).toHaveBeenCalledWith(event);
  });

  describe('error path', () => {
    let loggerErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      statsService.finalise = jest.fn().mockRejectedValue(new Error('boom'));
      loggerErrorSpy = jest.spyOn(worker['logger'], 'error');
    });

    it('should resolve (not throw) and log error with userId and sessionId when finalise rejects on session.completed', async () => {
      const event = makeEvent();
      await expect(worker.onSessionCompleted(event)).resolves.toBeUndefined();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(event.userId),
        expect.any(Error),
      );
      expect(loggerErrorSpy.mock.calls[0][0]).toEqual(
        expect.stringContaining(event.sessionId),
      );
    });

    it('should resolve (not throw) and log error with userId and sessionId when finalise rejects on session.abandoned', async () => {
      const event = makeEvent();
      await expect(worker.onSessionAbandoned(event)).resolves.toBeUndefined();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(event.userId),
        expect.any(Error),
      );
      expect(loggerErrorSpy.mock.calls[0][0]).toEqual(
        expect.stringContaining(event.sessionId),
      );
    });

    it('should resolve (not throw) and log error with userId and sessionId when finalise rejects on session.interrupted', async () => {
      const event = makeEvent();
      await expect(worker.onSessionInterrupted(event)).resolves.toBeUndefined();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(event.userId),
        expect.any(Error),
      );
      expect(loggerErrorSpy.mock.calls[0][0]).toEqual(
        expect.stringContaining(event.sessionId),
      );
    });
  });
});
