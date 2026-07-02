import { StartupRecoveryService } from './startup-recovery.service';
import { SessionStatus } from '../enums/session-status.enum';
import { ActivityType } from '../enums/activity-type.enum';
import { ModuleSession } from '../entities/module-session.entity';
import { SessionStreamSample } from '../entities/session-stream-sample.entity';

// ─────────────────────────────────────────────────────────────────────────
// Rehydration contract (feature note [[26-state-rehydration]], test note
// [[29-test-state-rehydration]]): on bootstrap, StartupRecoveryService must
// REBUILD the ActivitySessionStore from ACTIVE/DISCONNECTED rows (root via
// setRoot, children via addChild, linked by rootSessionId), mark every
// rehydrated row DISCONNECTED with disconnectedAt = lastActivityAt, arm a
// per-session grace timer from process start (store.startGraceTimerForSession
// — NOT a hand-rolled setTimeout(lastActivityAt + grace - now)), and derive
// isPaused per child from the last PAUSED/RESUMED marker in
// session_stream_samples. This inverts today's bulk-abandon behavior.
//
// L2 compile-now: StartupRecoveryService's ctor is still (repo) only today;
// note 26 widens it to (repo, streamSampleRepo, activitySessionStore,
// activityEngine). Until then, construct via `as any` to bypass the arity
// check — a LOUD DI failure (TypeError) if the arity drifts unexpectedly.
//
// All cases below labeled [RED until spec 26-state-rehydration] are expected
// to FAIL against today's service — that is correct. Do NOT weaken these
// assertions to make them pass early.
// ─────────────────────────────────────────────────────────────────────────

function makeSession(
  status: SessionStatus,
  overrides: Partial<ModuleSession> = {},
): ModuleSession {
  const now = new Date();
  return {
    id: `session-${Math.random()}`,
    userId: 'user-1',
    activityType: ActivityType.BREATH,
    rootSessionId: null,
    status,
    startedAt: now,
    lastActivityAt: now,
    disconnectedAt: null,
    createdAt: now,
    ...overrides,
  };
}

function makeSampleRow(
  moduleSessionId: string,
  events: Array<{ event: string; timestamp: number }>,
): SessionStreamSample {
  return {
    id: `sample-${Math.random()}`,
    moduleSessionId,
    samples: events.map(({ event, timestamp }) => ({
      timestamp,
      data: { dataType: 'session_event', event },
    })),
    flushedAt: new Date(),
    createdAt: new Date(),
  };
}

/** Flattens every repo.save/repo.update call into a single list of
 *  persisted row shapes, so assertions don't need to care which
 *  persistence call the implementation ends up using. */
function collectPersistedRows(repoMock: {
  save: jest.Mock;
  update: jest.Mock;
}): Array<Partial<ModuleSession>> {
  const fromSave = repoMock.save.mock.calls.flatMap((call: unknown[]) => {
    const arg = call[0] as Partial<ModuleSession> | Partial<ModuleSession>[];
    return Array.isArray(arg) ? arg : [arg];
  });
  const fromUpdate = repoMock.update.mock.calls.map(
    (call: unknown[]) => call[1] as Partial<ModuleSession>,
  );
  return [...fromSave, ...fromUpdate];
}

describe('StartupRecoveryService', () => {
  let service: StartupRecoveryService;
  let repo: { find: jest.Mock; save: jest.Mock; update: jest.Mock };
  let streamSampleRepo: { find: jest.Mock };
  let store: {
    setRoot: jest.Mock;
    addChild: jest.Mock;
    getRootId: jest.Mock;
    startGraceTimerForSession: jest.Mock;
  };
  let engine: { abandonActivity: jest.Mock };

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    streamSampleRepo = { find: jest.fn().mockResolvedValue([]) };
    store = {
      setRoot: jest.fn(),
      addChild: jest.fn(),
      getRootId: jest.fn().mockReturnValue(null),
      startGraceTimerForSession: jest.fn(),
    };
    engine = { abandonActivity: jest.fn().mockResolvedValue(undefined) };

    // `as any` bypasses today's single-arg ctor — pin this until note 26
    // widens it (see file header / spec note 29, L2).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    service = new (StartupRecoveryService as any)(
      repo,
      streamSampleRepo,
      store,
      engine,
    );
  });

  describe('store reconstruction (target: RED until spec 26-state-rehydration)', () => {
    it('[RED until spec 26-state-rehydration] rebuilds the store via setRoot/addChild instead of bulk-abandoning', async () => {
      const root = makeSession(SessionStatus.ACTIVE, {
        id: 'root-1',
        activityType: ActivityType.ROOT,
        rootSessionId: null,
      });
      const child1 = makeSession(SessionStatus.ACTIVE, {
        id: 'child-1',
        rootSessionId: root.id,
      });
      const child2 = makeSession(SessionStatus.DISCONNECTED, {
        id: 'child-2',
        rootSessionId: root.id,
      });
      repo.find.mockResolvedValue([root, child1, child2]);

      await service.onApplicationBootstrap();

      expect(store.setRoot).toHaveBeenCalledTimes(1);
      expect(store.setRoot).toHaveBeenCalledWith(
        root.userId,
        root.id,
        expect.objectContaining({ sessionId: root.id, rootSessionId: null }),
      );

      expect(store.addChild).toHaveBeenCalledTimes(2);
      expect(store.addChild).toHaveBeenCalledWith(
        child1.userId,
        child1.id,
        expect.objectContaining({
          sessionId: child1.id,
          rootSessionId: root.id,
        }),
      );
      expect(store.addChild).toHaveBeenCalledWith(
        child2.userId,
        child2.id,
        expect.objectContaining({
          sessionId: child2.id,
          rootSessionId: root.id,
        }),
      );

      const persisted = collectPersistedRows(repo);
      expect(
        persisted.some((row) => row.status === SessionStatus.ABANDONED),
      ).toBe(false);
    });

    it('[RED until spec 26-state-rehydration] marks each rehydrated row DISCONNECTED with disconnectedAt = lastActivityAt', async () => {
      const lastActivityAt = new Date('2026-01-01T00:00:00.000Z');
      const session = makeSession(SessionStatus.ACTIVE, {
        id: 'session-1',
        rootSessionId: null,
        lastActivityAt,
      });
      repo.find.mockResolvedValue([session]);

      await service.onApplicationBootstrap();

      const persisted = collectPersistedRows(repo);
      const matched = persisted.some(
        (row) =>
          row.status === SessionStatus.DISCONNECTED &&
          row.disconnectedAt instanceof Date &&
          row.disconnectedAt.getTime() === lastActivityAt.getTime(),
      );
      expect(matched).toBe(true);
    });
  });

  describe('pause derive (target: RED until spec 26-state-rehydration)', () => {
    it('[RED until spec 26-state-rehydration] derives isPaused=true when the last pause-related marker is "paused"', async () => {
      const root = makeSession(SessionStatus.ACTIVE, {
        id: 'root-1',
        activityType: ActivityType.ROOT,
        rootSessionId: null,
      });
      const child = makeSession(SessionStatus.ACTIVE, {
        id: 'child-1',
        rootSessionId: root.id,
      });
      repo.find.mockResolvedValue([root, child]);
      streamSampleRepo.find.mockImplementation(
        (query: { where: { moduleSessionId: string } }) => {
          if (query.where.moduleSessionId === child.id) {
            return Promise.resolve([
              makeSampleRow(child.id, [
                { event: 'resumed', timestamp: 1000 },
                { event: 'paused', timestamp: 2000 },
              ]),
            ]);
          }
          return Promise.resolve([]);
        },
      );

      await service.onApplicationBootstrap();

      expect(store.addChild).toHaveBeenCalledWith(
        child.userId,
        child.id,
        expect.objectContaining({ isPaused: true }),
      );
    });

    it('[RED until spec 26-state-rehydration] derives isPaused=false when the last pause-related marker is "resumed"', async () => {
      const root = makeSession(SessionStatus.ACTIVE, {
        id: 'root-1',
        activityType: ActivityType.ROOT,
        rootSessionId: null,
      });
      const child = makeSession(SessionStatus.ACTIVE, {
        id: 'child-1',
        rootSessionId: root.id,
      });
      repo.find.mockResolvedValue([root, child]);
      streamSampleRepo.find.mockImplementation(
        (query: { where: { moduleSessionId: string } }) => {
          if (query.where.moduleSessionId === child.id) {
            return Promise.resolve([
              makeSampleRow(child.id, [
                { event: 'paused', timestamp: 1000 },
                { event: 'resumed', timestamp: 2000 },
              ]),
            ]);
          }
          return Promise.resolve([]);
        },
      );

      await service.onApplicationBootstrap();

      expect(store.addChild).toHaveBeenCalledWith(
        child.userId,
        child.id,
        expect.objectContaining({ isPaused: false }),
      );
    });

    it('[RED until spec 26-state-rehydration] derives isPaused=false when there is no pause-related marker at all', async () => {
      const root = makeSession(SessionStatus.ACTIVE, {
        id: 'root-1',
        activityType: ActivityType.ROOT,
        rootSessionId: null,
      });
      const child = makeSession(SessionStatus.ACTIVE, {
        id: 'child-1',
        rootSessionId: root.id,
      });
      repo.find.mockResolvedValue([root, child]);
      streamSampleRepo.find.mockImplementation(
        (query: { where: { moduleSessionId: string } }) => {
          if (query.where.moduleSessionId === child.id) {
            return Promise.resolve([
              makeSampleRow(child.id, [
                { event: 'session_started', timestamp: 500 },
              ]),
            ]);
          }
          return Promise.resolve([]);
        },
      );

      await service.onApplicationBootstrap();

      expect(store.addChild).toHaveBeenCalledWith(
        child.userId,
        child.id,
        expect.objectContaining({ isPaused: false }),
      );
    });
  });

  describe('grace from process start (target: RED until spec 26-state-rehydration)', () => {
    it('[RED until spec 26-state-rehydration] arms a grace timer via store.startGraceTimerForSession for each rehydrated session', async () => {
      const root = makeSession(SessionStatus.ACTIVE, {
        id: 'root-1',
        activityType: ActivityType.ROOT,
        rootSessionId: null,
      });
      const child = makeSession(SessionStatus.ACTIVE, {
        id: 'child-1',
        rootSessionId: root.id,
      });
      repo.find.mockResolvedValue([root, child]);

      await service.onApplicationBootstrap();

      expect(store.startGraceTimerForSession).toHaveBeenCalledWith(
        root.id,
        expect.any(Function),
      );
      expect(store.startGraceTimerForSession).toHaveBeenCalledWith(
        child.id,
        expect.any(Function),
      );
    });

    it('[RED until spec 26-state-rehydration] invokes engine.abandonActivity(userId, sessionId) when the captured onExpiry callback fires', async () => {
      const child = makeSession(SessionStatus.DISCONNECTED, {
        id: 'child-1',
        userId: 'user-1',
        rootSessionId: null,
      });
      repo.find.mockResolvedValue([child]);

      await service.onApplicationBootstrap();

      const call = store.startGraceTimerForSession.mock.calls.find(
        (args: unknown[]) => args[0] === child.id,
      ) as [string, () => void | Promise<void>] | undefined;
      if (!call) {
        throw new Error('startGraceTimerForSession was not called for child');
      }
      const onExpiry = call[1];
      await onExpiry();

      expect(engine.abandonActivity).toHaveBeenCalledWith(
        child.userId,
        child.id,
      );
    });
  });

  describe('no orphan sessions found (characterization — must stay GREEN)', () => {
    it('does not call repo.save, store methods, or engine.abandonActivity when repo.find is empty', async () => {
      repo.find.mockResolvedValue([]);

      await service.onApplicationBootstrap();

      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(store.setRoot).not.toHaveBeenCalled();
      expect(store.addChild).not.toHaveBeenCalled();
      expect(store.startGraceTimerForSession).not.toHaveBeenCalled();
      expect(engine.abandonActivity).not.toHaveBeenCalled();
    });
  });
});
