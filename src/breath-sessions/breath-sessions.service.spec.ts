import { BreathSessionsService } from './breath-sessions.service';
import { BreathSession } from './entities/breath-session.entity';
import { BreathSessionSettingsService } from './breath-session-settings.service';

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

    beforeEach(() => {
      settingsService = {
        findByUserAndSessions: jest.fn().mockResolvedValue(new Map()),
      };

      repository = {
        findAndCount: jest.fn(),
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

    describe('anonymous path (userId = null)', () => {
      it('returns only shared sessions ordered by createdAt DESC', async () => {
        const newer = makeSession({
          id: 'a',
          shared: true,
          createdAt: new Date('2026-02-01T00:00:00Z'),
        });
        const older = makeSession({
          id: 'b',
          shared: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        });

        repository.findAndCount.mockResolvedValue([[newer, older], 2]);

        const result = await service.findList(null, 1, 10);

        expect(repository.findAndCount).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { shared: true },
            order: { createdAt: 'DESC' },
          }),
        );
        expect(result.data[0].id).toBe('a');
        expect(result.data[1].id).toBe('b');
        expect(result.total).toBe(2);
      });

      it('excludes non-shared sessions', async () => {
        repository.findAndCount.mockResolvedValue([[], 0]);

        const result = await service.findList(null, 1, 10);

        expect(repository.findAndCount).toHaveBeenCalledWith(
          expect.objectContaining({ where: { shared: true } }),
        );
        expect(result.data).toHaveLength(0);
      });
    });

    describe('authenticated path (userId provided)', () => {
      const makeQb = (sessions: BreathSession[], total: number) => {
        const qb: jest.Mocked<any> = {
          leftJoin: jest.fn(),
          where: jest.fn(),
          addSelect: jest.fn(),
          orderBy: jest.fn(),
          addOrderBy: jest.fn(),
          skip: jest.fn(),
          take: jest.fn(),
          getManyAndCount: jest.fn().mockResolvedValue([sessions, total]),
        };
        // Make all builder methods return the same qb for chaining
        qb.leftJoin.mockReturnValue(qb);
        qb.where.mockReturnValue(qb);
        qb.addSelect.mockReturnValue(qb);
        qb.orderBy.mockReturnValue(qb);
        qb.addOrderBy.mockReturnValue(qb);
        qb.skip.mockReturnValue(qb);
        qb.take.mockReturnValue(qb);
        return qb;
      };

      it('orders by group_priority ASC then createdAt DESC', async () => {
        const sessions: BreathSession[] = [];
        const qb = makeQb(sessions, 0);
        repository.createQueryBuilder.mockReturnValue(qb);

        await service.findList('user-uuid', 1, 10);

        expect(qb.orderBy).toHaveBeenCalledWith('group_priority', 'ASC');
        expect(qb.addOrderBy).toHaveBeenCalledWith('session.createdAt', 'DESC');
      });

      it('own sessions (group 0) appear before starred-others (group 1)', async () => {
        const own = makeSession({
          id: 'own',
          userId: 'user-uuid',
          shared: true,
          createdAt: new Date('2026-01-01'),
        });
        const starred = makeSession({
          id: 'starred',
          userId: 'other-uuid',
          shared: true,
          createdAt: new Date('2026-02-01'),
        });

        // Service returns them in the order the DB returns them; DB orders by group_priority ASC
        // Simulate DB returning own first (group 0), starred second (group 1)
        const qb = makeQb([own, starred], 2);
        repository.createQueryBuilder.mockReturnValue(qb);

        const result = await service.findList('user-uuid', 1, 10);

        expect(result.data[0].id).toBe('own');
        expect(result.data[1].id).toBe('starred');
      });

      it('within same group, newer createdAt appears first', async () => {
        const newerOwn = makeSession({
          id: 'newer',
          userId: 'user-uuid',
          createdAt: new Date('2026-03-01'),
        });
        const olderOwn = makeSession({
          id: 'older',
          userId: 'user-uuid',
          createdAt: new Date('2026-01-01'),
        });

        // DB returns them newer-first within the same group (createdAt DESC)
        const qb = makeQb([newerOwn, olderOwn], 2);
        repository.createQueryBuilder.mockReturnValue(qb);

        const result = await service.findList('user-uuid', 1, 10);

        expect(result.data[0].id).toBe('newer');
        expect(result.data[1].id).toBe('older');
      });

      it('attaches isStarred from settingsService', async () => {
        const session = makeSession({ id: 'session-1', userId: 'user-uuid' });
        const qb = makeQb([session], 1);
        repository.createQueryBuilder.mockReturnValue(qb);

        const settingsMap = new Map([['session-1', { starred: true } as any]]);
        settingsService.findByUserAndSessions.mockResolvedValue(settingsMap);

        const result = await service.findList('user-uuid', 1, 10);

        expect((result.data[0] as any).isStarred).toBe(true);
      });

      it('defaults isStarred to false when no settings entry exists', async () => {
        const session = makeSession({ id: 'session-1', userId: 'user-uuid' });
        const qb = makeQb([session], 1);
        repository.createQueryBuilder.mockReturnValue(qb);
        settingsService.findByUserAndSessions.mockResolvedValue(new Map());

        const result = await service.findList('user-uuid', 1, 10);

        expect((result.data[0] as any).isStarred).toBe(false);
      });

      it('passes correct pagination to QueryBuilder', async () => {
        const qb = makeQb([], 0);
        repository.createQueryBuilder.mockReturnValue(qb);

        await service.findList('user-uuid', 3, 5);

        expect(qb.skip).toHaveBeenCalledWith(10); // (3-1)*5
        expect(qb.take).toHaveBeenCalledWith(5);
      });
    });
  });
});
