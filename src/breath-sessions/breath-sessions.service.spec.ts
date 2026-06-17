import { BadRequestException } from '@nestjs/common';
import { BreathSessionsService } from './breath-sessions.service';
import { BreathSession } from './entities/breath-session.entity';
import { BreathSessionSettingsService } from './breath-session-settings.service';
import { SessionSection } from '../../proto/generated/breath_sessions';

const makeSession = (overrides: Partial<BreathSession> = {}): BreathSession =>
  Object.assign(new BreathSession(), {
    id: 'session-uuid',
    userId: 'user-uuid',
    description: 'Test session',
    exercises: [],
    complexity: 0,
    shared: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

const sampleExercises = [
  {
    steps: [
      { type: 'inhale' as const, duration: 4 },
      { type: 'exhale' as const, duration: 4 },
    ],
    restDuration: 0,
    repeatCount: 3,
  },
];

describe('BreathSessionsService', () => {
  describe('create', () => {
    let service: BreathSessionsService;
    let repository: jest.Mocked<any>;

    beforeEach(() => {
      repository = {
        create: jest.fn((data: any) =>
          Object.assign(new BreathSession(), data),
        ),
        save: jest.fn((entity: any) => Promise.resolve(entity)),
      };
      const mockStatsService = {} as any;
      const mockConfigService = { get: jest.fn().mockReturnValue(50) } as any;
      const mockChangeLogService = {
        log: jest.fn().mockResolvedValue(1),
      } as any;
      const mockEventEmitter = { emit: jest.fn() } as any;
      service = new BreathSessionsService(
        repository,
        {} as any,
        mockStatsService,
        mockConfigService,
        mockChangeLogService,
        mockEventEmitter,
      );
    });

    it('computes complexity from exercises', async () => {
      const dto = {
        description: 'Test',
        exercises: sampleExercises,
        shared: false,
      };
      const result = await service.create('user-uuid', dto);

      // (4+4)*3 = 24
      expect(result.complexity).toBe(24);
    });

    it('sets complexity to 0 for empty exercises', async () => {
      const dto = { description: 'Test', exercises: [], shared: false };
      const result = await service.create('user-uuid', dto);

      expect(result.complexity).toBe(0);
    });
  });

  describe('update', () => {
    let service: BreathSessionsService;
    let repository: jest.Mocked<any>;

    beforeEach(() => {
      repository = {
        findOne: jest.fn(),
        save: jest.fn((entity: any) => Promise.resolve(entity)),
      };
      const mockStatsService = {} as any;
      const mockConfigService = { get: jest.fn().mockReturnValue(50) } as any;
      const mockChangeLogService = {
        log: jest.fn().mockResolvedValue(1),
      } as any;
      const mockEventEmitter = { emit: jest.fn() } as any;
      service = new BreathSessionsService(
        repository,
        {} as any,
        mockStatsService,
        mockConfigService,
        mockChangeLogService,
        mockEventEmitter,
      );
    });

    it('recalculates complexity when exercises change', async () => {
      const existing = makeSession({ complexity: 0 });
      repository.findOne.mockResolvedValue(existing);

      const result = await service.update('session-uuid', 'user-uuid', {
        exercises: sampleExercises,
      });

      expect(result.complexity).toBe(24);
    });

    it('keeps existing complexity when exercises are not provided', async () => {
      const existing = makeSession({ complexity: 42 });
      repository.findOne.mockResolvedValue(existing);

      const result = await service.update('session-uuid', 'user-uuid', {
        description: 'New desc',
      });

      expect(result.complexity).toBe(42);
    });
  });

  describe('replace', () => {
    let service: BreathSessionsService;
    let repository: jest.Mocked<any>;

    beforeEach(() => {
      repository = {
        findOne: jest.fn(),
        save: jest.fn((entity: any) => Promise.resolve(entity)),
      };
      const mockStatsService = {} as any;
      const mockConfigService = { get: jest.fn().mockReturnValue(50) } as any;
      const mockChangeLogService = {
        log: jest.fn().mockResolvedValue(1),
      } as any;
      const mockEventEmitter = { emit: jest.fn() } as any;
      service = new BreathSessionsService(
        repository,
        {} as any,
        mockStatsService,
        mockConfigService,
        mockChangeLogService,
        mockEventEmitter,
      );
    });

    it('computes complexity from the new exercises', async () => {
      const existing = makeSession({ complexity: 0 });
      repository.findOne.mockResolvedValue(existing);

      const dto = {
        description: 'Replaced',
        exercises: sampleExercises,
        shared: true,
      };
      const result = await service.replace('session-uuid', 'user-uuid', dto);

      expect(result.complexity).toBe(24);
    });
  });

  describe('findList', () => {
    let service: BreathSessionsService;
    let repository: jest.Mocked<any>;
    let settingsService: jest.Mocked<
      Pick<BreathSessionSettingsService, 'findByUserAndSessions'>
    >;

    // Helper: build a chainable query builder stub whose getMany() returns the given rows
    const makeQb = (rows: BreathSession[]) => {
      const qb: jest.Mocked<any> = {
        innerJoin: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        orderBy: jest.fn(),
        addOrderBy: jest.fn(),
        take: jest.fn(),
        getMany: jest.fn().mockResolvedValue(rows),
      };
      qb.innerJoin.mockReturnValue(qb);
      qb.where.mockReturnValue(qb);
      qb.andWhere.mockReturnValue(qb);
      qb.orderBy.mockReturnValue(qb);
      qb.addOrderBy.mockReturnValue(qb);
      qb.take.mockReturnValue(qb);
      return qb;
    };

    // Encode a cursor the same way the service does (base64url JSON)
    const encodeCursor = (
      section: SessionSection,
      createdAt: string,
      id: string,
    ) =>
      Buffer.from(JSON.stringify({ section, createdAt, id })).toString(
        'base64url',
      );

    beforeEach(() => {
      settingsService = {
        findByUserAndSessions: jest.fn().mockResolvedValue(new Map()),
      };

      repository = {
        createQueryBuilder: jest.fn(),
      };

      const mockStatsService = {} as any;
      const mockConfigService = { get: jest.fn().mockReturnValue(50) } as any;
      const mockChangeLogService = {
        log: jest.fn().mockResolvedValue(1),
      } as any;
      const mockEventEmitter = { emit: jest.fn() } as any;

      service = new BreathSessionsService(
        repository,
        settingsService as any,
        mockStatsService,
        mockConfigService,
        mockChangeLogService,
        mockEventEmitter,
      );
    });

    it('first page (no cursor): returns items tagged with their section, nextCursor encodes last row', async () => {
      const starred = makeSession({
        id: 's1',
        userId: 'other',
        createdAt: new Date('2026-03-01T00:00:00Z'),
      });
      const mine = makeSession({
        id: 'm1',
        userId: 'user-uuid',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      });
      const shared = makeSession({
        id: 'sh1',
        userId: 'other',
        shared: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });

      // With pageSize=3 and 1 row per section, the loop fills all three sections
      repository.createQueryBuilder
        .mockReturnValueOnce(makeQb([starred])) // STARRED section
        .mockReturnValueOnce(makeQb([mine])) // MINE section
        .mockReturnValueOnce(makeQb([shared])); // SHARED section

      const result = await service.findList('user-uuid', null, 3);

      expect(result.items).toHaveLength(3);
      expect(result.items[0].id).toBe('s1');
      expect(result.items[0].section).toBe(SessionSection.STARRED);
      expect(result.items[1].id).toBe('m1');
      expect(result.items[1].section).toBe(SessionSection.MINE);
      expect(result.items[2].id).toBe('sh1');
      expect(result.items[2].section).toBe(SessionSection.SHARED);
      // Full page of 3 → nextCursor encodes the last row (SHARED, sh1)
      expect(result.nextCursor).not.toBeNull();
      const decoded = JSON.parse(
        Buffer.from(result.nextCursor!, 'base64url').toString(),
      );
      expect(decoded.section).toBe(SessionSection.SHARED);
      expect(decoded.id).toBe('sh1');
    });

    it('second page: cursor applies keyset to starting section only, continues disjointly', async () => {
      const mine2 = makeSession({
        id: 'm2',
        userId: 'user-uuid',
        createdAt: new Date('2026-01-15T00:00:00Z'),
      });
      const shared2 = makeSession({
        id: 'sh2',
        userId: 'other',
        shared: true,
        createdAt: new Date('2026-01-10T00:00:00Z'),
      });

      // Cursor points to end of MINE section
      const cursor = encodeCursor(
        SessionSection.MINE,
        '2026-02-01T00:00:00.000Z',
        'm1',
      );

      repository.createQueryBuilder
        .mockReturnValueOnce(makeQb([mine2])) // MINE with keyset applied
        .mockReturnValueOnce(makeQb([shared2])); // SHARED unbounded

      const result = await service.findList('user-uuid', cursor, 2);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('m2');
      expect(result.items[0].section).toBe(SessionSection.MINE);
      expect(result.items[1].id).toBe('sh2');
      expect(result.items[1].section).toBe(SessionSection.SHARED);

      // The MINE query builder should have received andWhere with the keyset using date_trunc
      const mineQb = repository.createQueryBuilder.mock.results[0].value;
      expect(mineQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('date_trunc'),
        expect.objectContaining({ cursorId: 'm1' }),
      );
      expect(mineQb.orderBy).toHaveBeenCalledWith(
        expect.stringContaining('date_trunc'),
        'DESC',
      );

      // The SHARED query builder should NOT have received andWhere (unbounded)
      const sharedQb = repository.createQueryBuilder.mock.results[1].value;
      expect(sharedQb.andWhere).not.toHaveBeenCalled();
    });

    it('section boundary spill: STARRED yields fewer than pageSize, remainder filled from MINE', async () => {
      const starred1 = makeSession({
        id: 's1',
        userId: 'other',
        createdAt: new Date('2026-03-01T00:00:00Z'),
      });
      const mine1 = makeSession({
        id: 'm1',
        userId: 'user-uuid',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      });
      const mine2 = makeSession({
        id: 'm2',
        userId: 'user-uuid',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });

      // pageSize=3, STARRED returns 1, MINE fills remaining 2, SHARED not reached
      repository.createQueryBuilder
        .mockReturnValueOnce(makeQb([starred1])) // STARRED → 1 row
        .mockReturnValueOnce(makeQb([mine1, mine2])); // MINE → 2 rows (remaining)

      const result = await service.findList('user-uuid', null, 3);

      expect(result.items).toHaveLength(3);
      expect(result.items[0].section).toBe(SessionSection.STARRED);
      expect(result.items[1].section).toBe(SessionSection.MINE);
      expect(result.items[2].section).toBe(SessionSection.MINE);
      // Exactly 3 items = full page → nextCursor set to last row
      expect(result.nextCursor).not.toBeNull();
    });

    it('anonymous caller: only SHARED rows returned, no isStarred, cursor honored', async () => {
      const shared = makeSession({
        id: 'sh1',
        userId: 'other',
        shared: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });

      repository.createQueryBuilder.mockReturnValueOnce(makeQb([shared]));

      const result = await service.findList(null, null, 5);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('sh1');
      expect(result.items[0].section).toBe(SessionSection.SHARED);
      // isStarred not set for anonymous
      expect((result.items[0] as any).isStarred).toBeUndefined();
      // Less than pageSize → no next cursor
      expect(result.nextCursor).toBeNull();
    });

    it('anonymous with cursor: applies keyset to SHARED query', async () => {
      const cursor = encodeCursor(
        SessionSection.SHARED,
        '2026-01-01T00:00:00.000Z',
        'sh0',
      );
      repository.createQueryBuilder.mockReturnValueOnce(makeQb([]));

      await service.findList(null, cursor, 5);

      const qb = repository.createQueryBuilder.mock.results[0].value;
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('cursorCreatedAt'),
        expect.objectContaining({ cursorId: 'sh0' }),
      );
    });

    it('anonymous with STARRED cursor: throws BadRequestException', async () => {
      const badCursor = encodeCursor(
        SessionSection.STARRED,
        '2026-01-01T00:00:00.000Z',
        'sid',
      );
      await expect(service.findList(null, badCursor, 5)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('empty result: items is empty, nextCursor is null', async () => {
      repository.createQueryBuilder
        .mockReturnValueOnce(makeQb([]))
        .mockReturnValueOnce(makeQb([]))
        .mockReturnValueOnce(makeQb([]));

      const result = await service.findList('user-uuid', null, 10);

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('isStarred: STARRED-section rows are true by definition', async () => {
      const session = makeSession({
        id: 's1',
        userId: 'other',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });

      repository.createQueryBuilder
        .mockReturnValueOnce(makeQb([session])) // STARRED → 1 row fills page
        .mockReturnValueOnce(makeQb([])) // MINE (not reached due to full page)
        .mockReturnValueOnce(makeQb([])); // SHARED (not reached)

      // settingsService returns starred=false for this id (should be overridden)
      settingsService.findByUserAndSessions.mockResolvedValue(
        new Map([['s1', { starred: false } as any]]),
      );

      const result = await service.findList('user-uuid', null, 1);

      expect(result.items[0].isStarred).toBe(true);
    });

    it('isStarred: MINE/SHARED rows reflect settingsService result', async () => {
      const session = makeSession({
        id: 'm1',
        userId: 'user-uuid',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });

      repository.createQueryBuilder
        .mockReturnValueOnce(makeQb([])) // STARRED → empty
        .mockReturnValueOnce(makeQb([session])); // MINE → 1 row fills page

      settingsService.findByUserAndSessions.mockResolvedValue(
        new Map([['m1', { starred: true } as any]]),
      );

      const result = await service.findList('user-uuid', null, 1);

      expect(result.items[0].isStarred).toBe(true);
    });

    it('isStarred: defaults to false when settingsService has no entry', async () => {
      const session = makeSession({
        id: 'm1',
        userId: 'user-uuid',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });

      repository.createQueryBuilder
        .mockReturnValueOnce(makeQb([]))
        .mockReturnValueOnce(makeQb([session]));

      settingsService.findByUserAndSessions.mockResolvedValue(new Map());

      const result = await service.findList('user-uuid', null, 1);

      expect(result.items[0].isStarred).toBe(false);
    });

    it('malformed cursor: throws BadRequestException', async () => {
      await expect(
        service.findList('user-uuid', 'not-valid-base64url!!', 10),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cursor with invalid section value: throws BadRequestException', async () => {
      const badCursor = Buffer.from(
        JSON.stringify({
          section: 99,
          createdAt: '2026-01-01T00:00:00Z',
          id: 'sid',
        }),
      ).toString('base64url');
      await expect(
        service.findList('user-uuid', badCursor, 10),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('pageSize=0: throws BadRequestException for authenticated caller', async () => {
      await expect(
        service.findList('user-uuid', null, 0),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('pageSize=0: throws BadRequestException for anonymous caller', async () => {
      await expect(service.findList(null, null, 0)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
