import { SyncService } from './sync.service';
import { ChangesResult } from 'src/changelog/changelog.service';

type ChangeLogMock = {
  getChanges: jest.Mock;
  getMinEventId: jest.Mock;
  purge: jest.Mock;
};

function makeChangeLogService(): ChangeLogMock {
  return {
    getChanges: jest.fn(),
    getMinEventId: jest.fn(),
    purge: jest.fn(),
  };
}

function makeRawEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    entity: 'breath_session',
    refId: 'ref-uuid-1',
    action: 'create',
    userId: 'user-uuid-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeChangesResult(
  events: ReturnType<typeof makeRawEvent>[],
  cursor: number,
  hasMore: boolean,
): ChangesResult {
  return { events: events as any, cursor, hasMore };
}

describe('SyncService', () => {
  let service: SyncService;
  let changeLog: ChangeLogMock;

  beforeEach(() => {
    changeLog = makeChangeLogService();
    service = new SyncService(changeLog as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Phase 1: getChanges() — happy path
  // -----------------------------------------------------------------------

  describe('getChanges() — happy path', () => {
    it('should return events, cursor and hasMore from changeLogService when changes exist', async () => {
      const event = makeRawEvent({ id: 10 });
      changeLog.getMinEventId.mockResolvedValue(1);
      changeLog.getChanges.mockResolvedValue(
        makeChangesResult([event], 10, false),
      );

      const result = await service.getChanges('user-uuid-1', 5, 20);

      expect(result).toMatchObject({
        cursor: 10,
        hasMore: false,
        events: [expect.objectContaining({ id: 10 })],
      });
    });

    it('should set hasMore=true when changeLogService returns a result with hasMore=true', async () => {
      changeLog.getMinEventId.mockResolvedValue(1);
      changeLog.getChanges.mockResolvedValue(
        makeChangesResult([makeRawEvent()], 1, true),
      );

      const result = await service.getChanges('user-uuid-1', 0, 10);

      expect((result as any).hasMore).toBe(true);
    });

    it('should set hasMore=false when changeLogService returns a result with hasMore=false', async () => {
      changeLog.getMinEventId.mockResolvedValue(1);
      changeLog.getChanges.mockResolvedValue(
        makeChangesResult([makeRawEvent()], 1, false),
      );

      const result = await service.getChanges('user-uuid-1', 0, 10);

      expect((result as any).hasMore).toBe(false);
    });

    it('should pass userId, afterId and limit through to changeLogService.getChanges unchanged', async () => {
      changeLog.getMinEventId.mockResolvedValue(null);
      changeLog.getChanges.mockResolvedValue(makeChangesResult([], 42, false));

      await service.getChanges('target-user', 42, 50);

      expect(changeLog.getChanges).toHaveBeenCalledWith('target-user', 42, 50);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 1: getChanges() — empty result behavior
  // -----------------------------------------------------------------------

  describe('getChanges() — empty result', () => {
    it('should return an empty events array when changeLogService returns no events', async () => {
      changeLog.getMinEventId.mockResolvedValue(null);
      changeLog.getChanges.mockResolvedValue(makeChangesResult([], 0, false));

      const result = await service.getChanges('user-uuid-1', 0, 20);

      expect((result as any).events).toEqual([]);
    });

    it('should preserve afterId as the cursor when changeLogService returns no events (cursor must not collapse to 0)', async () => {
      changeLog.getMinEventId.mockResolvedValue(null);
      changeLog.getChanges.mockResolvedValue(makeChangesResult([], 42, false));

      const result = await service.getChanges('user-uuid-1', 42, 20);

      expect((result as any).cursor).toBe(42);
    });

    it('should report hasMore=false when no events are returned', async () => {
      changeLog.getMinEventId.mockResolvedValue(null);
      changeLog.getChanges.mockResolvedValue(makeChangesResult([], 0, false));

      const result = await service.getChanges('user-uuid-1', 0, 20);

      expect((result as any).hasMore).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 2: full-resync trigger
  // -----------------------------------------------------------------------

  describe('getChanges() — full-resync trigger', () => {
    it('should return { fullResync: true } when afterId < minEventId and afterId !== 0 and minEventId !== null', async () => {
      changeLog.getMinEventId.mockResolvedValue(10);

      const result = await service.getChanges('user-uuid-1', 3, 20);

      expect(result).toEqual({ fullResync: true });
    });

    it('should not call changeLogService.getChanges() when the full-resync branch is taken', async () => {
      changeLog.getMinEventId.mockResolvedValue(10);

      await service.getChanges('user-uuid-1', 3, 20);

      expect(changeLog.getChanges).not.toHaveBeenCalled();
    });

    it('should call changeLogService.getMinEventId() exactly once on the full-resync path', async () => {
      changeLog.getMinEventId.mockResolvedValue(10);

      await service.getChanges('user-uuid-1', 3, 20);

      expect(changeLog.getMinEventId).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 2: full-resync NOT triggered on sentinel / edge inputs
  // -----------------------------------------------------------------------

  describe('getChanges() — no full-resync on edge inputs', () => {
    it('should not trigger full-resync when afterId === 0 even if minEventId is greater than 0 (sentinel "start from beginning")', async () => {
      changeLog.getMinEventId.mockResolvedValue(5);
      changeLog.getChanges.mockResolvedValue(makeChangesResult([], 0, false));

      const result = await service.getChanges('user-uuid-1', 0, 20);

      expect(result).not.toEqual({ fullResync: true });
    });

    it('should not trigger full-resync when minEventId === null (empty changelog)', async () => {
      changeLog.getMinEventId.mockResolvedValue(null);
      changeLog.getChanges.mockResolvedValue(makeChangesResult([], 0, false));

      const result = await service.getChanges('user-uuid-1', 5, 20);

      expect(result).not.toEqual({ fullResync: true });
    });

    it('should not trigger full-resync when afterId >= minEventId', async () => {
      changeLog.getMinEventId.mockResolvedValue(5);
      changeLog.getChanges.mockResolvedValue(makeChangesResult([], 5, false));

      const result = await service.getChanges('user-uuid-1', 5, 20);

      expect(result).not.toEqual({ fullResync: true });
    });

    it('should call changeLogService.getChanges() in each of the non-full-resync edge cases', async () => {
      changeLog.getChanges.mockResolvedValue(makeChangesResult([], 0, false));

      // afterId === 0, minEventId > 0
      changeLog.getMinEventId.mockResolvedValue(5);
      await service.getChanges('user-uuid-1', 0, 20);
      expect(changeLog.getChanges).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();
      changeLog.getChanges.mockResolvedValue(makeChangesResult([], 0, false));

      // minEventId === null
      changeLog.getMinEventId.mockResolvedValue(null);
      await service.getChanges('user-uuid-1', 5, 20);
      expect(changeLog.getChanges).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();
      changeLog.getChanges.mockResolvedValue(makeChangesResult([], 5, false));

      // afterId >= minEventId
      changeLog.getMinEventId.mockResolvedValue(5);
      await service.getChanges('user-uuid-1', 5, 20);
      expect(changeLog.getChanges).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 3: event field projection
  // -----------------------------------------------------------------------

  describe('getChanges() — event field projection', () => {
    it('should map each event to exactly { id, entity, refId, action, createdAt } when underlying events carry extra fields like userId', async () => {
      const createdAt = new Date('2026-03-01T10:00:00Z');
      const raw = makeRawEvent({
        id: 7,
        entity: 'breath_session',
        refId: 'ref-007',
        action: 'update',
        userId: 'user-abc',
        createdAt,
      });
      changeLog.getMinEventId.mockResolvedValue(null);
      changeLog.getChanges.mockResolvedValue(
        makeChangesResult([raw], 7, false),
      );

      const result = await service.getChanges('user-abc', 0, 10);
      const events = (result as any).events as Record<string, unknown>[];

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        id: 7,
        entity: 'breath_session',
        refId: 'ref-007',
        action: 'update',
        createdAt,
      });
    });

    it('should not include userId on any returned event', async () => {
      const events = [
        makeRawEvent({ id: 1, userId: 'user-a' }),
        makeRawEvent({ id: 2, userId: 'user-b' }),
      ];
      changeLog.getMinEventId.mockResolvedValue(null);
      changeLog.getChanges.mockResolvedValue(
        makeChangesResult(events, 2, false),
      );

      const result = await service.getChanges('user-a', 0, 10);
      const returned = (result as any).events as Record<string, unknown>[];

      for (const ev of returned) {
        expect(ev).not.toHaveProperty('userId');
      }
    });

    it('should preserve the order of events as returned by changeLogService', async () => {
      const raw = [
        makeRawEvent({ id: 3 }),
        makeRawEvent({ id: 1 }),
        makeRawEvent({ id: 2 }),
      ];
      changeLog.getMinEventId.mockResolvedValue(null);
      changeLog.getChanges.mockResolvedValue(makeChangesResult(raw, 2, false));

      const result = await service.getChanges('user-uuid-1', 0, 10);
      const ids = (result as any).events.map((e: any) => e.id);

      expect(ids).toEqual([3, 1, 2]);
    });

    it('should forward the cursor and hasMore from changeLogService unchanged alongside the projected events', async () => {
      changeLog.getMinEventId.mockResolvedValue(null);
      changeLog.getChanges.mockResolvedValue(
        makeChangesResult([makeRawEvent({ id: 99 })], 99, true),
      );

      const result = await service.getChanges('user-uuid-1', 0, 10);

      expect((result as any).cursor).toBe(99);
      expect((result as any).hasMore).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 4: purgeOldEvents()
  // -----------------------------------------------------------------------

  describe('purgeOldEvents()', () => {
    it('should call changeLogService.purge() with no arguments when purgeOldEvents() is invoked', async () => {
      changeLog.purge.mockResolvedValue(undefined);

      await service.purgeOldEvents();

      expect(changeLog.purge).toHaveBeenCalledTimes(1);
      expect(changeLog.purge).toHaveBeenCalledWith();
    });

    it('should resolve without throwing when changeLogService.purge() resolves', async () => {
      changeLog.purge.mockResolvedValue(undefined);

      await expect(service.purgeOldEvents()).resolves.toBeUndefined();
    });

    it('should propagate the rejection when changeLogService.purge() rejects (no silent swallow)', async () => {
      changeLog.purge.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.purgeOldEvents()).rejects.toThrow(
        'DB connection lost',
      );
    });
  });
});
