import { ActivityEngine } from './activity-engine.service';
import { ActivitySessionStore } from './activity-session-store.service';
import { ActivityType } from '../enums/activity-type.enum';
import { SessionStatus } from '../enums/session-status.enum';
import { ActivityStartDto } from '../dto/activity-start.dto';
import { ModuleSession } from '../entities/module-session.entity';
import { SessionEvents } from '../events/session.events';
import {
  StreamDataType,
  StreamSessionEvent,
} from '../constants/stream-data-types';

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

function makeActivitySessionStore(): ActivitySessionStore {
  const configService = {
    get: jest.fn().mockReturnValue(undefined),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return new ActivitySessionStore(configService as any);
}

function makeSession(overrides: Partial<ModuleSession> = {}): ModuleSession {
  const now = new Date();
  return {
    id: 'session-1',
    userId: 'user-1',
    activityType: ActivityType.BREATH,
    status: SessionStatus.ACTIVE,
    startedAt: now,
    lastActivityAt: now,
    createdAt: now,
    ...overrides,
  } as ModuleSession;
}

describe('ActivityEngine', () => {
  let engine: ActivityEngine;
  let activitySessionStore: ActivitySessionStore;
  let repo: ReturnType<typeof makeRepo>;
  let emitter: ReturnType<typeof makeEmitter>;
  let streamEngine: ReturnType<typeof makeStreamEngine>;

  beforeEach(() => {
    activitySessionStore = makeActivitySessionStore();
    repo = makeRepo();
    emitter = makeEmitter();
    streamEngine = makeStreamEngine();

    engine = new ActivityEngine(
      repo as any,
      activitySessionStore,
      emitter as any,
      streamEngine as any,
    );
  });

  describe('startActivity', () => {
    it('creates ModuleSession row, writes ActivityState to store, returns session', async () => {
      const dto: ActivityStartDto = {
        activityType: ActivityType.BREATH,
      };
      const session = makeSession();
      repo.create.mockReturnValue(session);
      repo.save.mockResolvedValue(session);

      const result = await engine.startActivity('user-1', dto);

      expect(repo.create).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledWith(session);
      expect(result).toBe(session);
      const state = activitySessionStore.get('user-1');
      expect(state).toBeDefined();
      expect(state!.sessionId).toBe('session-1');
      expect(state!.activityType).toBe(ActivityType.BREATH);
    });

    it('uses client timestamp as startedAt when provided', async () => {
      const clientTs = Date.now() - 5000;
      const dto: ActivityStartDto = {
        activityType: ActivityType.BREATH,
        clientTimestampMs: clientTs,
      };
      let capturedCreate: Partial<ModuleSession> | undefined;
      repo.create.mockImplementation((data: Partial<ModuleSession>) => {
        capturedCreate = data;
        return { ...makeSession(), ...data };
      });
      repo.save.mockImplementation((s: ModuleSession) =>
        Promise.resolve({ ...s }),
      );

      await engine.startActivity('user-1', dto);

      expect(capturedCreate?.startedAt).toEqual(new Date(clientTs));
    });

    it('uses server now() as startedAt when clientTimestampMs is absent', async () => {
      const before = Date.now();
      const dto: ActivityStartDto = { activityType: ActivityType.BREATH };
      let capturedCreate: Partial<ModuleSession> | undefined;
      repo.create.mockImplementation((data: Partial<ModuleSession>) => {
        capturedCreate = data;
        return { ...makeSession(), ...data };
      });
      repo.save.mockImplementation((s: ModuleSession) =>
        Promise.resolve({ ...s }),
      );

      await engine.startActivity('user-1', dto);
      const after = Date.now();

      expect(capturedCreate?.startedAt).toEqual(expect.any(Date));
      expect(capturedCreate!.startedAt!.getTime()).toBeGreaterThanOrEqual(
        before,
      );
      expect(capturedCreate!.startedAt!.getTime()).toBeLessThanOrEqual(after);
    });

    it('lastActivityAt is always server-clocked, not the client timestamp (critical guard)', async () => {
      const pastClientTs = Date.now() - 60_000; // 60s in the past
      const dto: ActivityStartDto = {
        activityType: ActivityType.BREATH,
        clientTimestampMs: pastClientTs,
      };
      let capturedCreate: Partial<ModuleSession> | undefined;
      repo.create.mockImplementation((data: Partial<ModuleSession>) => {
        capturedCreate = data;
        return {
          ...makeSession(),
          startedAt: data.startedAt ?? new Date(),
          lastActivityAt: data.lastActivityAt ?? new Date(),
        };
      });
      repo.save.mockImplementation((s: ModuleSession) =>
        Promise.resolve({ ...s }),
      );

      const before = Date.now();
      await engine.startActivity('user-1', dto);
      const after = Date.now();

      // startedAt should be the past client value
      expect(capturedCreate!.startedAt!.getTime()).toBe(pastClientTs);
      // lastActivityAt must be server now(), not the client value
      expect(capturedCreate!.lastActivityAt!.getTime()).toBeGreaterThanOrEqual(
        before,
      );
      expect(capturedCreate!.lastActivityAt!.getTime()).toBeLessThanOrEqual(
        after,
      );
      expect(capturedCreate!.lastActivityAt!.getTime()).not.toBe(pastClientTs);
    });
  });

  describe('endActivity', () => {
    it('status=completed, endedAt set, removed from store, session.completed emitted', async () => {
      const session = makeSession();
      activitySessionStore.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
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
      expect(activitySessionStore.has('user-1')).toBe(false);
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

    it('uses client end timestamp as endedAt when valid and >= startedAt', async () => {
      const startedAt = new Date(Date.now() - 10_000);
      const session = makeSession({ startedAt });
      activitySessionStore.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        isPaused: false,
      });
      repo.findOne.mockResolvedValue(session);
      repo.save.mockImplementation((s: ModuleSession) =>
        Promise.resolve({ ...s }),
      );

      const clientEndTs = startedAt.getTime() + 8_000;
      await engine.endActivity('user-1', clientEndTs);

      expect(session.endedAt).toEqual(new Date(clientEndTs));
      expect(session.endedAt!.getTime() - session.startedAt.getTime()).toBe(
        8_000,
      );
    });

    it('falls back to server now() when client end timestamp is before startedAt', async () => {
      const startedAt = new Date(Date.now() - 5_000);
      const session = makeSession({ startedAt });
      activitySessionStore.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        isPaused: false,
      });
      repo.findOne.mockResolvedValue(session);
      repo.save.mockImplementation((s: ModuleSession) =>
        Promise.resolve({ ...s }),
      );

      // client end is 2s before startedAt — invalid
      const clientEndTs = startedAt.getTime() - 2_000;
      const before = Date.now();
      await engine.endActivity('user-1', clientEndTs);
      const after = Date.now();

      expect(session.endedAt).toEqual(expect.any(Date));
      // endedAt must be >= startedAt (no negative duration)
      expect(session.endedAt!.getTime()).toBeGreaterThanOrEqual(
        session.startedAt.getTime(),
      );
      // and should be server-clocked
      expect(session.endedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(session.endedAt!.getTime()).toBeLessThanOrEqual(after);
    });

    it('falls back to server now() when client end timestamp is zero/NaN', async () => {
      const startedAt = new Date(Date.now() - 3_000);
      const session = makeSession({ startedAt });
      activitySessionStore.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        isPaused: false,
      });
      repo.findOne.mockResolvedValue(session);
      repo.save.mockImplementation((s: ModuleSession) =>
        Promise.resolve({ ...s }),
      );

      const before = Date.now();
      await engine.endActivity('user-1', 0);
      const after = Date.now();

      expect(session.endedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(session.endedAt!.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('onDisconnect', () => {
    it('status=disconnected, disconnectedAt set via repo.update, kept in store, no emit', async () => {
      activitySessionStore.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
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
      expect(activitySessionStore.has('user-1')).toBe(true);
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('no-op when no active session', async () => {
      await engine.onDisconnect('user-1');

      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('abandonActivity', () => {
    it('status=abandoned, endedAt set, removed from store, session.abandoned emitted', async () => {
      const session = makeSession({ status: SessionStatus.DISCONNECTED });
      activitySessionStore.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
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
      expect(activitySessionStore.has('user-1')).toBe(false);
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
      activitySessionStore.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        isPaused: false,
      });
      repo.findOne.mockResolvedValue(session);

      await engine.abandonActivity('user-1');

      expect(repo.save).not.toHaveBeenCalled();
      expect(emitter.emit).not.toHaveBeenCalled();
      expect(activitySessionStore.has('user-1')).toBe(false);
    });
  });

  describe('abandonStale', () => {
    it('(a) stale ACTIVE row → abandoned + emitted + store cleared', async () => {
      const session = makeSession({ status: SessionStatus.ACTIVE });
      activitySessionStore.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
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

      await engine.abandonStale('user-1', 'session-1');

      expect(session.status).toBe(SessionStatus.ABANDONED);
      expect(session.endedAt).toBeDefined();
      expect(activitySessionStore.has('user-1')).toBe(false);
      expect(streamEngine.push).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            dataType: StreamDataType.SESSION_EVENT,
            event: StreamSessionEvent.ABANDONED,
          }),
        }),
      );
      expect(emitter.emit).toHaveBeenCalledWith(
        SessionEvents.ABANDONED,
        expect.objectContaining({ sessionId: 'session-1', userId: 'user-1' }),
      );
    });

    it('(b) already-COMPLETED row → no-op, no event, store cleared', async () => {
      const session = makeSession({ status: SessionStatus.COMPLETED });
      activitySessionStore.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        isPaused: false,
      });
      repo.findOne.mockResolvedValue(session);

      await engine.abandonStale('user-1', 'session-1');

      expect(repo.save).not.toHaveBeenCalled();
      expect(emitter.emit).not.toHaveBeenCalled();
      expect(activitySessionStore.has('user-1')).toBe(false);
    });

    it('(c) DB-only row not in store → row updated + emitted', async () => {
      const session = makeSession({ status: SessionStatus.ACTIVE });
      // No store entry for user-1
      repo.findOne.mockResolvedValue(session);
      const savedSession = {
        ...session,
        status: SessionStatus.ABANDONED,
        endedAt: new Date(),
      };
      repo.save.mockResolvedValue(savedSession);

      await engine.abandonStale('user-1', 'session-1');

      expect(repo.save).toHaveBeenCalled();
      expect(streamEngine.push).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            dataType: StreamDataType.SESSION_EVENT,
            event: StreamSessionEvent.ABANDONED,
          }),
        }),
      );
      expect(emitter.emit).toHaveBeenCalledWith(
        SessionEvents.ABANDONED,
        expect.objectContaining({ sessionId: 'session-1', userId: 'user-1' }),
      );
    });

    it('(d) row not found in DB → store cleared, no save, no event', async () => {
      activitySessionStore.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        isPaused: false,
      });
      repo.findOne.mockResolvedValue(null);

      await engine.abandonStale('user-1', 'session-1');

      expect(repo.save).not.toHaveBeenCalled();
      expect(emitter.emit).not.toHaveBeenCalled();
      expect(activitySessionStore.has('user-1')).toBe(false);
    });
  });

  describe('getActiveSession', () => {
    it('returns entry from store', () => {
      const state = {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        isPaused: false,
      };
      activitySessionStore.set('user-1', state);

      expect(engine.getActiveSession('user-1')).toBe(state);
    });

    it('returns undefined when no entry', () => {
      expect(engine.getActiveSession('user-1')).toBeUndefined();
    });
  });

  describe('resumeActivity', () => {
    it('happy path: sets status=ACTIVE, clears disconnectedAt, updates lastActivityAt, returns session', async () => {
      const session = makeSession({ status: SessionStatus.DISCONNECTED });
      activitySessionStore.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
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
      // store entry should have lastActivityAt synced
      expect(activitySessionStore.get('user-1')?.lastActivityAt).toEqual(
        session.lastActivityAt,
      );
    });

    it('returns null when no store entry', async () => {
      const result = await engine.resumeActivity('user-1');

      expect(result).toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('returns null and cleans store when session not in DB', async () => {
      activitySessionStore.set('user-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        isPaused: false,
      });
      repo.findOne.mockResolvedValue(null);

      const result = await engine.resumeActivity('user-1');

      expect(result).toBeNull();
      expect(activitySessionStore.has('user-1')).toBe(false);
    });
  });
});
