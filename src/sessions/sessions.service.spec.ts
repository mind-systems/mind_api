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

  // ─────────────────────────────────────────────────────────────────────────────
  // Orphan root cleanup (target: RED until spec 15-deleterun-orphan-root-cleanup)
  //
  // Design decisions recorded in .ai-factory/notes/19-test-root-reaping-deleterun.md:
  //   P4: count remaining siblings AFTER deleting child via discrete delete({ id }) calls.
  //
  // L2 compile-now: rootSessionId is not on ModuleSession yet (added in spec 02).
  //   → pass via makeSession({ ... } as any) or use `rootSessionId: 'root-id' as any`.
  // L1 two-state: assert the outcome (one vs two deletes, child-then-root order).
  // ─────────────────────────────────────────────────────────────────────────────
  describe('orphan root cleanup', () => {
    // Separate repo mock that includes count — added without touching the outer beforeEach
    // so the existing deleteRun cases above are unaffected.
    let repoWithCount: jest.Mocked<any>;
    let serviceWithCount: SessionsService;

    beforeEach(() => {
      repoWithCount = {
        findOne: jest.fn(),
        delete: jest.fn().mockResolvedValue({ affected: 1 }),
        createQueryBuilder: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      };
      serviceWithCount = new SessionsService(
        repoWithCount,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        { delete: jest.fn() } as any,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        { delete: jest.fn() } as any,
      );
    });

    // [RED until spec 15-deleterun-orphan-root-cleanup]
    // Last child deleted → spec 15 must also delete the root (cascade removes shared bio).
    // P4: count after child delete; if 0 siblings → delete root.
    it('[RED until spec 15-deleterun-orphan-root-cleanup] should delete the root after its last child is deleted', async () => {
      const ROOT_ID = 'root-session-id';
      const child = makeSession({
        id: 'child-session-id',
        userId: 'user-1',
        endedAt: new Date(),
        // L2: rootSessionId not on entity yet — set via as any.
        ...({ rootSessionId: ROOT_ID } as any),
      });
      repoWithCount.findOne.mockResolvedValue(child);
      repoWithCount.count.mockResolvedValue(0); // no siblings remain after child delete

      await serviceWithCount.deleteRun('user-1', 'child-session-id');

      // Outcome: two deletes must fire — child first, then root.
      expect(repoWithCount.delete).toHaveBeenCalledTimes(2);
      expect(repoWithCount.delete).toHaveBeenNthCalledWith(1, {
        id: 'child-session-id',
      });
      expect(repoWithCount.delete).toHaveBeenNthCalledWith(2, { id: ROOT_ID });
    });

    // [RED until spec 15-deleterun-orphan-root-cleanup]
    // Sibling remains → root MUST be kept (shared bio is still in use; cascade would delete it).
    // P4: the keep decision must be driven by a sibling count, not short-circuited.
    it('[RED until spec 15-deleterun-orphan-root-cleanup] should keep the root when a sibling child remains', async () => {
      const ROOT_ID = 'root-session-id';
      const child = makeSession({
        id: 'child-session-id',
        userId: 'user-2',
        endedAt: new Date(),
        ...({ rootSessionId: ROOT_ID } as any),
      });
      repoWithCount.findOne.mockResolvedValue(child);
      repoWithCount.count.mockResolvedValue(1); // one sibling still exists

      await serviceWithCount.deleteRun('user-2', 'child-session-id');

      // Outcome: only one delete (the child). Root must NOT be touched.
      expect(repoWithCount.delete).toHaveBeenCalledTimes(1);
      expect(repoWithCount.delete).toHaveBeenCalledWith({
        id: 'child-session-id',
      });
      expect(repoWithCount.delete).not.toHaveBeenCalledWith({ id: ROOT_ID });
      // P4: the keep-path must consult the sibling count — not short-circuit.
      // This assertion is RED now (current code never calls count) and GREEN after spec 15
      // implements the count-then-keep logic.
      expect(repoWithCount.count).toHaveBeenCalledWith({
        where: { rootSessionId: ROOT_ID },
      });
    });

    // [RED until spec 15-deleterun-orphan-root-cleanup]
    // The deleted child must NOT be counted in the sibling count — spec 15 must count AFTER delete.
    // Assert via invocation order: delete fires before count.
    it('[RED until spec 15-deleterun-orphan-root-cleanup] should count siblings after deleting the child (deleted child not counted)', async () => {
      const ROOT_ID = 'root-session-id';
      const child = makeSession({
        id: 'child-order-id',
        userId: 'user-3',
        endedAt: new Date(),
        ...({ rootSessionId: ROOT_ID } as any),
      });
      repoWithCount.findOne.mockResolvedValue(child);
      repoWithCount.count.mockResolvedValue(0);

      await serviceWithCount.deleteRun('user-3', 'child-order-id');

      // P4: the child delete invocation order must precede the count invocation order.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const deleteOrder: number = repoWithCount.delete.mock
        .invocationCallOrder[0] as number;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const countOrder: number = repoWithCount.count.mock
        .invocationCallOrder[0] as number;
      expect(typeof countOrder).toBe('number'); // count must have been called
      expect(deleteOrder).toBeLessThan(countOrder);
    });

    // [characterization — must stay GREEN]
    // Legacy session with rootSessionId = null → behaves exactly as today:
    // only one delete fires (the session itself), no root cleanup.
    // This case must stay GREEN now AND after spec 15 lands.
    it('[characterization — must stay GREEN] should behave as today for a legacy session with rootSessionId null', async () => {
      const legacySession = makeSession({
        id: 'legacy-session-id',
        userId: 'user-legacy',
        endedAt: new Date(),
        // L2: rootSessionId not on entity yet — null means no root parent.
        ...({ rootSessionId: null } as any),
      });
      repoWithCount.findOne.mockResolvedValue(legacySession);

      await serviceWithCount.deleteRun('user-legacy', 'legacy-session-id');

      // Only the single session delete fires — no root delete, no count query.
      expect(repoWithCount.delete).toHaveBeenCalledTimes(1);
      expect(repoWithCount.delete).toHaveBeenCalledWith({
        id: 'legacy-session-id',
      });
      expect(repoWithCount.count).not.toHaveBeenCalled();
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
