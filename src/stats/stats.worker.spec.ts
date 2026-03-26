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
});
