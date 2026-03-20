import { ActivityEngine } from './activity-engine.service';
import { StateStore } from '../state-store';
import { ActivityType } from '../enums/activity-type.enum';
import { SessionStatus } from '../enums/session-status.enum';
import { ActivityStartDto } from '../dto/activity-start.dto';
import { LiveSession } from '../entities/live-session.entity';
import { SessionEvents } from '../events/session.events';

function makeRepo() {
  return {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
}

function makeEmitter() {
  return { emit: jest.fn() };
}

function makeStreamEngine() {
  return { push: jest.fn() };
}

function makeSession(overrides: Partial<LiveSession> = {}): LiveSession {
  const now = new Date();
  return {
    id: 'session-1',
    userId: 'user-1',
    activityType: ActivityType.BREATH_SESSION,
    status: SessionStatus.ACTIVE,
    startedAt: now,
    lastActivityAt: now,
    createdAt: now,
    ...overrides,
  } as LiveSession;
}

describe('ActivityEngine', () => {
  let engine: ActivityEngine;
  let stateStore: StateStore;
  let repo: ReturnType<typeof makeRepo>;
  let emitter: ReturnType<typeof makeEmitter>;
  let streamEngine: ReturnType<typeof makeStreamEngine>;

  beforeEach(() => {
    stateStore = new StateStore();
    repo = makeRepo();
    emitter = makeEmitter();
    streamEngine = makeStreamEngine();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    engine = new ActivityEngine(repo as any, stateStore, emitter as any, streamEngine as any);
  });

  describe('startActivity', () => {
    it('creates LiveSession row, writes ActivityState to activityMap, returns session', async () => {
      const dto: ActivityStartDto = {
        activityType: ActivityType.BREATH_SESSION,
      };
      const session = makeSession();
      repo.create.mockReturnValue(session);
      repo.save.mockResolvedValue(session);

      const result = await engine.startActivity('user-1', dto);

      expect(repo.create).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(session);
      expect(result).toBe(session);
      const state = stateStore.activityMap.get('user-1');
      expect(state).toBeDefined();
      expect(state!.sessionId).toBe('session-1');
      expect(state!.activityType).toBe(ActivityType.BREATH_SESSION);
    });
  });

  describe('endActivity', () => {
    it('status=completed, endedAt set, removed from activityMap, session.completed emitted', async () => {
      const session = makeSession();
      stateStore.activityMap.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH_SESSION,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        isPaused: false,
      });
      repo.findOne.mockResolvedValue(session);
      const savedSession = {
        ...session,
        status: SessionStatus.COMPLETED,
        endedAt: new Date(),
      };
      repo.save.mockResolvedValue(savedSession);

      const result = await engine.endActivity('user-1');

      expect(result).toBe(savedSession);
      expect(session.status).toBe(SessionStatus.COMPLETED);
      expect(session.endedAt).toBeDefined();
      expect(stateStore.activityMap.has('user-1')).toBe(false);
      expect(emitter.emit).toHaveBeenCalledWith(
        SessionEvents.COMPLETED,
        expect.objectContaining({
          sessionId: savedSession.id,
          userId: 'user-1',
        }),
      );
    });

    it('returns null and does not call repo.save when no active session', async () => {
      const result = await engine.endActivity('user-1');

      expect(result).toBeNull();
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('onDisconnect', () => {
    it('status=disconnected, disconnectedAt set via repo.update, kept in activityMap, no emit', async () => {
      stateStore.activityMap.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH_SESSION,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        isPaused: false,
      });

      await engine.onDisconnect('user-1');

      expect(repo.update).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          status: SessionStatus.DISCONNECTED,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          disconnectedAt: expect.any(Date),
        }),
      );
      expect(stateStore.activityMap.has('user-1')).toBe(true);
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('no-op when no active session', async () => {
      await engine.onDisconnect('user-1');

      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('abandonActivity', () => {
    it('status=abandoned, endedAt set, removed from activityMap, session.abandoned emitted', async () => {
      const session = makeSession({ status: SessionStatus.DISCONNECTED });
      stateStore.activityMap.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH_SESSION,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        isPaused: false,
      });
      repo.findOne.mockResolvedValue(session);
      const savedSession = {
        ...session,
        status: SessionStatus.ABANDONED,
        endedAt: new Date(),
      };
      repo.save.mockResolvedValue(savedSession);

      await engine.abandonActivity('user-1');

      expect(session.status).toBe(SessionStatus.ABANDONED);
      expect(session.endedAt).toBeDefined();
      expect(stateStore.activityMap.has('user-1')).toBe(false);
      expect(emitter.emit).toHaveBeenCalledWith(
        SessionEvents.ABANDONED,
        expect.objectContaining({
          sessionId: savedSession.id,
          userId: 'user-1',
        }),
      );
    });

    it('no-ops when session status=ACTIVE (reconnect beat the grace timer)', async () => {
      const session = makeSession({ status: SessionStatus.ACTIVE });
      stateStore.activityMap.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH_SESSION,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        isPaused: false,
      });
      repo.findOne.mockResolvedValue(session);

      await engine.abandonActivity('user-1');

      expect(repo.save).not.toHaveBeenCalled();
      expect(emitter.emit).not.toHaveBeenCalled();
      expect(stateStore.activityMap.has('user-1')).toBe(false);
    });
  });

  describe('getActiveSession', () => {
    it('returns entry from activityMap', () => {
      const state = {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH_SESSION,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        isPaused: false,
      };
      stateStore.activityMap.set('user-1', state);

      expect(engine.getActiveSession('user-1')).toBe(state);
    });

    it('returns undefined when no entry', () => {
      expect(engine.getActiveSession('user-1')).toBeUndefined();
    });
  });

  describe('resumeActivity', () => {
    it('happy path: sets status=ACTIVE, clears disconnectedAt, updates lastActivityAt, returns session', async () => {
      const session = makeSession({ status: SessionStatus.DISCONNECTED });
      stateStore.activityMap.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH_SESSION,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        isPaused: false,
      });
      repo.findOne.mockResolvedValue(session);
      const savedSession = {
        ...session,
        status: SessionStatus.ACTIVE,
        disconnectedAt: null,
      };
      repo.save.mockResolvedValue(savedSession);

      const result = await engine.resumeActivity('user-1');

      expect(result).toBe(savedSession);
      expect(session.status).toBe(SessionStatus.ACTIVE);
      expect(session.disconnectedAt).toBeNull();
      expect(session.lastActivityAt).toEqual(expect.any(Date));
      expect(repo.save).toHaveBeenCalledWith(session);
      // activityMap entry should have lastActivityAt synced
      expect(stateStore.activityMap.get('user-1')?.lastActivityAt).toEqual(
        session.lastActivityAt,
      );
    });

    it('returns null when no activityMap entry', async () => {
      const result = await engine.resumeActivity('user-1');

      expect(result).toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('returns null and cleans activityMap when session not in DB', async () => {
      stateStore.activityMap.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH_SESSION,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        isPaused: false,
      });
      repo.findOne.mockResolvedValue(null);

      const result = await engine.resumeActivity('user-1');

      expect(result).toBeNull();
      expect(stateStore.activityMap.has('user-1')).toBe(false);
    });
  });
});
