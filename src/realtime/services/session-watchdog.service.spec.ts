import { FindOperator } from 'typeorm';
import { SessionWatchdogService } from './session-watchdog.service';
import { SessionStatus } from '../enums/session-status.enum';
import { ActivityType } from '../enums/activity-type.enum';
import { ModuleSession } from '../entities/module-session.entity';

const FIXED_NOW = 1_700_000_000_000;
// Default TTL for empty-root reaping used across root-sweep cases.
const DEFAULT_EMPTY_ROOT_TTL_MS = 300_000;

function makeSession(
  overrides: Partial<
    Pick<ModuleSession, 'id' | 'userId' | 'status' | 'lastActivityAt'>
  > = {},
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

// Fixture helper for root sessions (activityType = 'root', rootSessionId = null).
// Uses `as any` casts for fields that don't exist on the entity yet (spec 02 adds them).
let _rootIdCounter = 0;
function makeRoot(overrides: Record<string, unknown> = {}): ModuleSession {
  _rootIdCounter++;
  return {
    id: `root-${_rootIdCounter}`,
    userId: `user-root-${_rootIdCounter}`,
    activityType: 'root' as any,
    rootSessionId: null as any,
    status: SessionStatus.DISCONNECTED,
    startedAt: new Date(FIXED_NOW - 700_000),
    // Default: past the TTL threshold so it would be reaped if childless
    lastActivityAt: new Date(FIXED_NOW - DEFAULT_EMPTY_ROOT_TTL_MS - 1_000),
    createdAt: new Date(FIXED_NOW - 700_000),
    ...overrides,
  } as unknown as ModuleSession;
}

describe('SessionWatchdogService', () => {
  let service: SessionWatchdogService;
  // repo now includes count and delete mocks for the root-sweep path.
  // The existing sweep() cases only use repo.find, so adding these mocks is non-breaking.
  let repo: { find: jest.Mock; count: jest.Mock; delete: jest.Mock };
  let activityEngine: { abandonStale: jest.Mock };
  let activeStreamRegistry: {
    hasLiveSubscriber: jest.Mock;
    closeAll: jest.Mock;
  };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    _rootIdCounter = 0;
    repo = {
      find: jest.fn(),
      count: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    activityEngine = { abandonStale: jest.fn().mockResolvedValue(undefined) };
    activeStreamRegistry = {
      hasLiveSubscriber: jest.fn().mockReturnValue(false),
      closeAll: jest.fn(),
    };
    // configService returns defaults for all keys EXCEPT WS_EMPTY_ROOT_TTL_MS and
    // WS_SESSION_MAX_IDLE_MS when branched — existing sweep() tests only rely on defaults.
    configService = {
      get: jest.fn((key: string, def: unknown) => {
        if (key === 'WS_EMPTY_ROOT_TTL_MS') return DEFAULT_EMPTY_ROOT_TTL_MS;
        return def;
      }),
    };
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
        expect.arrayContaining([
          SessionStatus.ACTIVE,
          SessionStatus.DISCONNECTED,
        ]),
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
      expect(activityEngine.abandonStale).toHaveBeenCalledWith(
        'user-a',
        'session-a',
      );
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
      expect(activityEngine.abandonStale).toHaveBeenCalledWith(
        'user-a',
        'session-a',
      );
      expect(activityEngine.abandonStale).toHaveBeenCalledWith(
        'user-b',
        'session-b',
      );
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
      expect(activeStreamRegistry.hasLiveSubscriber).toHaveBeenCalledWith(
        'user-a',
      );
      expect(activeStreamRegistry.hasLiveSubscriber).toHaveBeenCalledWith(
        'user-b',
      );
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
      expect(activityEngine.abandonStale).toHaveBeenCalledWith(
        'user-b',
        'session-b',
      );
      expect(activityEngine.abandonStale).not.toHaveBeenCalledWith(
        'user-a',
        expect.anything(),
      );
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
      expect(activityEngine.abandonStale).toHaveBeenCalledWith(
        'user-b',
        'session-b',
      );
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

  // ─────────────────────────────────────────────────────────────────────────────
  // sweepEmptyRoots — root reaping rule (target: RED until spec 08-janitor-empty-roots)
  //
  // Design decisions recorded in .ai-factory/notes/19-test-root-reaping-deleterun.md:
  //   P1: sweepEmptyRoots() is a SEPARATE public method, not folded into sweep().
  //   P2: The protected :52-110 query-construction chars must stay GREEN.
  //   P3: Per-root delete/count must be mock-visible (not a bulk QB delete).
  //
  // L2 compile-now: sweepEmptyRoots() does not exist yet → call via (service as any).
  // L1 two-state: assert the OUTCOME (was delete/abandonStale fired for this root?) not the SQL.
  // ─────────────────────────────────────────────────────────────────────────────
  describe('sweepEmptyRoots — root reaping rule', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
      // Provide an empty root list by default; individual cases override as needed.
      repo.find.mockResolvedValue([]);
      // Default: no children — override to 1 for the data-loss-guard case.
      repo.count.mockResolvedValue(0);
    });

    // [RED until spec 08-janitor-empty-roots]
    // Corrected rule: childless + past TTL → reap, EVEN if bio exists (bio no longer protects).
    it('[RED until spec 08-janitor-empty-roots] should reap a childless root past TTL even if it has bio', async () => {
      const root = makeRoot({ id: 'root-reap-bio', userId: 'user-reap-bio' });
      repo.find.mockResolvedValue([root]);
      repo.count.mockResolvedValue(0); // no children

      // L2: method does not exist yet → TypeError until spec 08 adds it → RED for feature-absent.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (service as any).sweepEmptyRoots();

      // P3: per-root observable outcome — either delete({ id }) or abandonStale(userId, id) must fire.
      const wasDeleted = repo.delete.mock.calls.some(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        ([arg]: [any]) => (arg as { id: string })?.id === root.id,
      );
      const wasAbandoned = activityEngine.abandonStale.mock.calls.some(
        ([uid, sid]: [string, string]) =>
          uid === root.userId && sid === root.id,
      );
      expect(wasDeleted || wasAbandoned).toBe(true);
    });

    // [RED until spec 08-janitor-empty-roots]
    // Data-loss guard: ≥1 child present → NEVER reap, regardless of bio or age.
    // A wrong predicate here silently cascades and deletes children + bio via FK ON DELETE CASCADE.
    it('[RED until spec 08-janitor-empty-roots] should NOT reap a root that has ≥1 child regardless of bio or age', async () => {
      const root = makeRoot({ id: 'root-has-child', userId: 'user-has-child' });
      repo.find.mockResolvedValue([root]);
      repo.count.mockResolvedValue(1); // has a child sibling — must not be reaped

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (service as any).sweepEmptyRoots();

      // Guard: no delete or abandon must target this root.
      const wasDeleted = repo.delete.mock.calls.some(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        ([arg]: [any]) => (arg as { id: string })?.id === root.id,
      );
      const wasAbandoned = activityEngine.abandonStale.mock.calls.some(
        ([uid, sid]: [string, string]) =>
          uid === root.userId && sid === root.id,
      );
      expect(wasDeleted || wasAbandoned).toBe(false);
    });

    // [RED until spec 08-janitor-empty-roots]
    // Live-subscriber skip — reuses hasLiveSubscriber (session-watchdog.service.ts:71).
    it('[RED until spec 08-janitor-empty-roots] should NOT reap a childless root that has a live subscriber', async () => {
      const root = makeRoot({ id: 'root-live', userId: 'user-live' });
      repo.find.mockResolvedValue([root]);
      repo.count.mockResolvedValue(0);
      activeStreamRegistry.hasLiveSubscriber.mockReturnValue(true);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (service as any).sweepEmptyRoots();

      const wasDeleted = repo.delete.mock.calls.some(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        ([arg]: [any]) => (arg as { id: string })?.id === root.id,
      );
      const wasAbandoned = activityEngine.abandonStale.mock.calls.some(
        ([uid, sid]: [string, string]) =>
          uid === root.userId && sid === root.id,
      );
      expect(wasDeleted || wasAbandoned).toBe(false);
    });

    // [RED until spec 08-janitor-empty-roots]
    // TTL guard — builder-contract assertion (P5).
    //
    // Bio-stream flush refreshes lastActivityAt (biometric-stream-engine.service.ts:183-184);
    // the TTL predicate must therefore be applied at the QUERY layer (LessThan in repo.find WHERE),
    // mirroring sweep() at session-watchdog.service.ts:57-63.
    //
    // The force-fresh-row outcome approach ("feed a fresh root via mock, assert no reap") is fragile
    // under query-side filtering: the mock ignores WHERE and returns the fresh root regardless, so the
    // loop reaps it → permanent RED after spec 08 ships — the exact "guard deeper than the mock sees"
    // trap (note 18 / L1). The builder-contract assertion here is the robust alternative (P5).
    it('[RED until spec 08-janitor-empty-roots] should query for empty roots scoped to activityType=root with a lastActivityAt LessThan(WS_EMPTY_ROOT_TTL_MS threshold)', async () => {
      repo.find.mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (service as any).sweepEmptyRoots();

      expect(repo.find).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const [callArg] = repo.find.mock.calls[0] as [any];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const lastActivityAt: unknown = callArg?.where?.lastActivityAt;

      const expectedThreshold = new Date(FIXED_NOW - DEFAULT_EMPTY_ROOT_TTL_MS);
      expect(lastActivityAt).toBeInstanceOf(FindOperator);
      expect((lastActivityAt as any).value).toEqual(expectedThreshold);

      // P6 — root-scoping predicate. Without `activityType: 'root'` in the candidate
      // query, sweepEmptyRoots() would pick up a disconnected practice CHILD past TTL
      // (its count({ rootSessionId: child.id }) is 0 → read as "childless") and
      // cascade-delete a real practice session + its bio. Pin the root scope at the
      // query layer alongside the TTL predicate.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(callArg?.where?.activityType).toBe('root');
    });

    // [characterization — must stay GREEN]
    // sweep() non-root stale-session reaping is unperturbed by the addition of sweepEmptyRoots().
    // P2: The protected sweep() query-construction chars already cover toHaveBeenCalledTimes(1).
    // This case verifies the behavioural outcome (abandonStale + closeAll) still fires for a
    // stale practice session when only sweep() is invoked — sweepEmptyRoots() is NOT called here.
    it('[characterization — must stay GREEN] should leave non-root stale-session reaping behavior unchanged', async () => {
      const staleSession = makeSession({
        userId: 'user-nrt',
        id: 'session-nrt',
      });
      repo.find.mockResolvedValue([staleSession]);

      await service.sweep();

      // The sweep() reap loop (session-watchdog.service.ts:82-83) must still fire.
      expect(activityEngine.abandonStale).toHaveBeenCalledWith(
        'user-nrt',
        'session-nrt',
      );
      expect(activeStreamRegistry.closeAll).toHaveBeenCalledWith('user-nrt');
      // sweepEmptyRoots() was NOT called — no root-level delete must have fired.
      expect(repo.delete).not.toHaveBeenCalled();
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
      jest
        .spyOn(global, 'setInterval')
        .mockImplementation((cb: TimerHandler) => {
          capturedCallback = cb as () => void;
          return 0 as unknown as ReturnType<typeof setInterval>;
        });
      const sweepSpy = jest
        .spyOn(service, 'sweep')
        .mockResolvedValue(undefined);

      service.onApplicationBootstrap();

      expect(capturedCallback).toBeDefined();
      capturedCallback!();

      expect(sweepSpy).toHaveBeenCalledTimes(1);
    });
  });
});
