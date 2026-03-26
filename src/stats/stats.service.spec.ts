import { StatsService, SessionEvent } from './stats.service';
import { ActivityType } from '../realtime/enums/activity-type.enum';

const NOW = new Date('2026-03-14T12:00:00Z');
const TODAY = '2026-03-14';
const YESTERDAY = '2026-03-13';
const TWO_DAYS_AGO = '2026-03-12';

function makeEvent(
  startedAt: Date,
  endedAt: Date,
  overrides: Partial<SessionEvent> = {},
): SessionEvent {
  return {
    sessionId: 'sess-1',
    userId: 'user-1',
    startedAt,
    endedAt,
    activityType: ActivityType.BREATH,
    ...overrides,
  };
}

function makeQb() {
  const qb = {
    insert: jest.fn(),
    into: jest.fn(),
    values: jest.fn(),
    orIgnore: jest.fn(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  qb.insert.mockReturnValue(qb);
  qb.into.mockReturnValue(qb);
  qb.values.mockReturnValue(qb);
  qb.orIgnore.mockReturnValue(qb);
  return qb;
}

function makeRepo(existingRow: Record<string, unknown> | null = null) {
  const saved: Record<string, unknown>[] = [];
  const qb = makeQb();

  const manager = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    findOne: jest.fn().mockResolvedValue(existingRow),
    save: jest.fn().mockImplementation((_entity: unknown, row: unknown) => {
      saved.push(row as Record<string, unknown>);
      return Promise.resolve(row);
    }),
    query: jest.fn().mockResolvedValue([]),
  };

  return {
    manager: {
      transaction: jest
        .fn()
        .mockImplementation(
          async (cb: (m: typeof manager) => Promise<void>) => {
            await cb(manager);
          },
        ),
    },
    findOne: jest.fn().mockResolvedValue(existingRow),
    _manager: manager,
    _saved: saved,
    _qb: qb,
  };
}

describe('StatsService', () => {
  beforeEach(() => {
    process.env.WS_MIN_SESSION_DURATION_S = '10';
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.WS_MIN_SESSION_DURATION_S;
  });

  function makeService(existingRow: Record<string, unknown> | null = null): {
    service: StatsService;
    repo: ReturnType<typeof makeRepo>;
  } {
    const repo = makeRepo(existingRow);
    const configService = { get: jest.fn().mockReturnValue(10) };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const svc = new StatsService(repo as any, configService as any);
    return { service: svc, repo };
  }

  describe('finalise — short session skipped', () => {
    it('skips session shorter than WS_MIN_SESSION_DURATION_S', async () => {
      const { service: svc, repo } = makeService();
      const start = new Date(NOW.getTime());
      const end = new Date(NOW.getTime() + 5_000); // 5s < 10s
      await svc.finalise(makeEvent(start, end));
      expect(repo.manager.transaction).not.toHaveBeenCalled();
    });
  });

  describe('finalise — first session (no existing row)', () => {
    it('creates row with currentStreak=1 via orIgnore + update', async () => {
      const newRow = {
        userId: 'user-1',
        totalSessions: 0,
        totalDurationSeconds: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastSessionDate: null,
      };
      const { service: svc, repo } = makeService(newRow);
      const start = new Date(NOW.getTime());
      const end = new Date(NOW.getTime() + 20_000);
      await svc.finalise(makeEvent(start, end));
      const mgr = repo._manager;
      expect(mgr.createQueryBuilder).toHaveBeenCalled();
      expect(repo._qb.orIgnore).toHaveBeenCalled();
      expect(mgr.save).toHaveBeenCalledTimes(1);
      const [, saved] = mgr.save.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(saved.currentStreak).toBe(1);
      expect(saved.longestStreak).toBe(1);
      expect(saved.totalSessions).toBe(1);
      expect(saved.lastSessionDate).toBe(TODAY);
    });
  });

  describe('finalise — concurrent first session (race condition)', () => {
    it('second concurrent caller orIgnore no-ops, still updates correctly', async () => {
      // Simulate: findOne returns an already-inserted (but zeroed) row
      const zeroRow = {
        userId: 'user-1',
        totalSessions: 0,
        totalDurationSeconds: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastSessionDate: null,
      };
      const { service: svc, repo } = makeService(zeroRow);
      const start = new Date(NOW.getTime());
      const end = new Date(NOW.getTime() + 20_000);
      await svc.finalise(makeEvent(start, end));
      const mgr = repo._manager;
      const [, saved] = mgr.save.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(saved.totalSessions).toBe(1);
      expect(saved.currentStreak).toBe(1);
    });
  });

  describe('finalise — same day session', () => {
    it('keeps currentStreak unchanged', async () => {
      const existingRow = {
        userId: 'user-1',
        totalSessions: 3,
        totalDurationSeconds: 60,
        currentStreak: 4,
        longestStreak: 5,
        lastSessionDate: TODAY,
      };
      const { service: svc, repo } = makeService(existingRow);
      const start = new Date(NOW.getTime());
      const end = new Date(NOW.getTime() + 30_000);
      await svc.finalise(makeEvent(start, end));
      const mgr = repo._manager;
      const [, saved] = mgr.save.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(saved.currentStreak).toBe(4); // unchanged
      expect(saved.totalSessions).toBe(4);
    });
  });

  describe('finalise — consecutive day (yesterday)', () => {
    it('increments currentStreak', async () => {
      const existingRow = {
        userId: 'user-1',
        totalSessions: 1,
        totalDurationSeconds: 20,
        currentStreak: 2,
        longestStreak: 2,
        lastSessionDate: YESTERDAY,
      };
      const { service: svc, repo } = makeService(existingRow);
      const start = new Date(NOW.getTime());
      const end = new Date(NOW.getTime() + 20_000);
      await svc.finalise(makeEvent(start, end));
      const mgr = repo._manager;
      const [, saved] = mgr.save.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(saved.currentStreak).toBe(3);
      expect(saved.longestStreak).toBe(3);
    });
  });

  describe('finalise — streak broken (gap > 1 day)', () => {
    it('resets currentStreak to 1', async () => {
      const existingRow = {
        userId: 'user-1',
        totalSessions: 5,
        totalDurationSeconds: 100,
        currentStreak: 7,
        longestStreak: 10,
        lastSessionDate: TWO_DAYS_AGO,
      };
      const { service: svc, repo } = makeService(existingRow);
      const start = new Date(NOW.getTime());
      const end = new Date(NOW.getTime() + 20_000);
      await svc.finalise(makeEvent(start, end));
      const mgr = repo._manager;
      const [, saved] = mgr.save.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(saved.currentStreak).toBe(1);
      // longestStreak stays at 10
      expect(saved.longestStreak).toBe(10);
    });
  });

  describe('finalise — new currentStreak beats longestStreak', () => {
    it('updates longestStreak', async () => {
      const existingRow = {
        userId: 'user-1',
        totalSessions: 1,
        totalDurationSeconds: 20,
        currentStreak: 5,
        longestStreak: 5,
        lastSessionDate: YESTERDAY,
      };
      const { service: svc, repo } = makeService(existingRow);
      const start = new Date(NOW.getTime());
      const end = new Date(NOW.getTime() + 20_000);
      await svc.finalise(makeEvent(start, end));
      const mgr = repo._manager;
      const [, saved] = mgr.save.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(saved.currentStreak).toBe(6);
      expect(saved.longestStreak).toBe(6);
    });
  });

  describe('getStats', () => {
    it('returns zeroed defaults when no row exists', async () => {
      const { service: svc } = makeService(null);
      const stats = await svc.getStats('user-1');
      expect(stats).toEqual({
        totalSessions: 0,
        totalDurationSeconds: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastSessionDate: null,
        maxCompletedComplexity: 0,
      });
    });
  });
});
