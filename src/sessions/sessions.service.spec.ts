import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { ModuleSession } from '../realtime/entities/module-session.entity';
import { ActivityType } from '../realtime/enums/activity-type.enum';
import { SessionStatus } from '../realtime/enums/session-status.enum';

const makeSession = (overrides: Partial<ModuleSession> = {}): ModuleSession =>
  Object.assign(new ModuleSession(), {
    id: 'session-uuid',
    userId: 'user-uuid',
    activityType: ActivityType.BREATH,
    status: SessionStatus.COMPLETED,
    startedAt: new Date(),
    lastActivityAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  });

describe('SessionsService.deleteRun', () => {
  let service: SessionsService;
  let moduleSessionRepo: jest.Mocked<any>;
  let bioSampleRepo: jest.Mocked<any>;
  let streamSampleRepo: jest.Mocked<any>;

  beforeEach(() => {
    moduleSessionRepo = {
      findOne: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    // bio/stream repos have delete mocks so we can assert they are never called by the service
    // (cascade is DB-level, not service-level)
    bioSampleRepo = { delete: jest.fn() };
    streamSampleRepo = { delete: jest.fn() };

    service = new SessionsService(
      moduleSessionRepo,
      bioSampleRepo,
      streamSampleRepo,
    );
  });

  describe('owned session → delete + cascade', () => {
    it('calls delete with the session id and resolves', async () => {
      const session = makeSession({
        id: 'session-uuid',
        userId: 'user-uuid',
        endedAt: new Date(),
      });
      moduleSessionRepo.findOne.mockResolvedValue(session);
      moduleSessionRepo.delete.mockResolvedValue({ affected: 1 });

      await expect(
        service.deleteRun('user-uuid', 'session-uuid'),
      ).resolves.toBeUndefined();

      expect(moduleSessionRepo.delete).toHaveBeenCalledWith({
        id: 'session-uuid',
      });
    });

    it('does NOT call delete on bio or stream repos (cascade is DB-level)', async () => {
      // user_stats is also never referenced — stats are untouched by design
      const session = makeSession({
        id: 'session-uuid',
        userId: 'user-uuid',
        endedAt: new Date(),
      });
      moduleSessionRepo.findOne.mockResolvedValue(session);
      moduleSessionRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteRun('user-uuid', 'session-uuid');

      expect(bioSampleRepo.delete).not.toHaveBeenCalled();
      expect(streamSampleRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('foreign session → 403', () => {
    it('throws ForbiddenException and never calls delete', async () => {
      const session = makeSession({
        id: 'session-uuid',
        userId: 'other-user-uuid',
      });
      moduleSessionRepo.findOne.mockResolvedValue(session);

      await expect(
        service.deleteRun('user-uuid', 'session-uuid'),
      ).rejects.toThrow(ForbiddenException);

      expect(moduleSessionRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('missing session → 404', () => {
    it('throws NotFoundException and never calls delete', async () => {
      moduleSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteRun('user-uuid', 'nonexistent-uuid'),
      ).rejects.toThrow(NotFoundException);

      expect(moduleSessionRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('live session → 409', () => {
    it('throws ConflictException and never calls delete when endedAt is null', async () => {
      const session = makeSession({
        id: 'session-uuid',
        userId: 'user-uuid',
        endedAt: null as any,
        status: SessionStatus.ACTIVE,
      });
      moduleSessionRepo.findOne.mockResolvedValue(session);

      await expect(
        service.deleteRun('user-uuid', 'session-uuid'),
      ).rejects.toThrow(ConflictException);

      expect(moduleSessionRepo.delete).not.toHaveBeenCalled();
    });
  });
});

describe('SessionsService.listRuns', () => {
  let listRunsService: SessionsService;
  let listRunsModuleSessionRepo: jest.Mocked<any>;

  // Build a fully chainable QueryBuilder mock. Every builder method (leftJoin, addSelect, where,
  // andWhere, orderBy, take, skip) returns the same qb so calls can be inspected afterwards.
  // getCount resolves a count; getRawAndEntities resolves { entities, raw }.
  function makeListRunsQb(
    entities: Partial<ModuleSession>[],
    raw: Record<string, unknown>[],
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qb: any = {
      leftJoin: jest.fn(),
      addSelect: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      take: jest.fn(),
      skip: jest.fn(),
      getCount: jest.fn().mockResolvedValue(entities.length),
      getRawAndEntities: jest.fn().mockResolvedValue({ entities, raw }),
    };
    qb.leftJoin.mockReturnValue(qb);
    qb.addSelect.mockReturnValue(qb);
    qb.where.mockReturnValue(qb);
    qb.andWhere.mockReturnValue(qb);
    qb.orderBy.mockReturnValue(qb);
    qb.take.mockReturnValue(qb);
    qb.skip.mockReturnValue(qb);
    return qb;
  }

  beforeEach(() => {
    listRunsModuleSessionRepo = {
      findOne: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    listRunsService = new SessionsService(
      listRunsModuleSessionRepo,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      { delete: jest.fn() } as any,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      { delete: jest.fn() } as any,
    );
  });

  // Why builder-contract and not outcome-only: the run-history exclusion is implemented in
  // spec 07 as a SQL-level .andWhere('ms.activityType != :root', ...). With a fully mocked QB,
  // .andWhere(...) is an inert stub — it cannot change what getRawAndEntities returns — so an
  // outcome-only "seed a root row, expect it absent" assertion is RED now AND stays RED after
  // spec 07 (the mock keeps returning the seeded root regardless of the new clause). Worse, an
  // implementer chasing that red would likely add a JS .filter() after take/skip, inflating
  // total and short-paging — a pagination bug the test would be steering toward. The
  // ROADMAP_TESTS.md "no real DB" rule rules out e2e. Hence this deliberate L1 carve-out.
  it('should add an activityType != root filter to the listRuns query — RED until spec 07-exclude-root-from-stats', async () => {
    const qb = makeListRunsQb([], []);
    listRunsModuleSessionRepo.createQueryBuilder.mockReturnValue(qb);

    await listRunsService.listRuns('user-1');

    // Spec 07 will add: .andWhere('ms.activityType != :root', { root: ... }) or similar.
    // Today listRuns only calls andWhere('ms.endedAt IS NOT NULL'), so no activityType inequality
    // exists → RED for the right reason. After spec 07 adds the clause → GREEN.
    // The matcher is intentionally loose on the bound parameter: do NOT assert param name or
    // ActivityType.ROOT (it does not exist yet per L2); only that some andWhere introduces an
    // activityType inequality.
    expect(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      qb.andWhere.mock.calls.some(
        ([sql]: [string]) => /activityType/.test(sql) && /!=/.test(sql),
      ),
    ).toBe(true);
  });

  // Characterization (GREEN now, must stay GREEN through spec 07). Locks the row-mapping shape
  // and proves spec 07's new SQL clause does not disturb the JS-side result mapping.
  // (It cannot verify the root is filtered out — the mock ignores the clause; that is the
  // target case above via the builder-contract assertion.)
  it('should still return breath and meditation rows mapped from the query result', async () => {
    const breathEntity = Object.assign(new ModuleSession(), {
      id: 'breath-id',
      userId: 'user-1',
      activityType: ActivityType.BREATH,
      startedAt: new Date('2026-01-01T10:00:00Z'),
      endedAt: new Date('2026-01-01T10:20:00Z'), // 1200s
    });
    const meditationEntity = Object.assign(new ModuleSession(), {
      id: 'meditation-id',
      userId: 'user-1',
      activityType: ActivityType.MEDITATION,
      startedAt: new Date('2026-01-02T10:00:00Z'),
      endedAt: new Date('2026-01-02T10:30:00Z'), // 1800s
    });

    const entities = [breathEntity, meditationEntity];
    const raw = [
      { bs_description: null, bs_complexity: null },
      { bs_description: null, bs_complexity: null },
    ];

    const qb = makeListRunsQb(entities, raw);
    listRunsModuleSessionRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await listRunsService.listRuns('user-1');

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);

    expect(result.items[0].id).toBe('breath-id');
    expect(result.items[0].activityType).toBe(ActivityType.BREATH);
    expect(result.items[0].durationSeconds).toBe(1200);

    expect(result.items[1].id).toBe('meditation-id');
    expect(result.items[1].activityType).toBe(ActivityType.MEDITATION);
    expect(result.items[1].durationSeconds).toBe(1800);
  });
});
