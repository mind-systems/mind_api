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
import { WsErrorCode } from '../constants/ws-error-codes';

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
      await engine.endActivity('user-1', undefined, clientEndTs);

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
      await engine.endActivity('user-1', undefined, clientEndTs);
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
      await engine.endActivity('user-1', undefined, 0);
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

  describe('handleReconnect', () => {
    it('(a) store hit → cancels grace timer and returns resumed ModuleSession', async () => {
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

      const result = await engine.handleReconnect(
        'user-1',
        'client-session-id',
      );

      // returns the resumed ModuleSession (has an `id` field, not { abandoned: true })
      expect(result).toBe(savedSession);
      // findOne was called by resumeActivity with the store session id, not the clientSessionId
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'session-1' } });
    });

    it('(b) no store entry + ABANDONED DB row → resolves { abandoned: true }', async () => {
      const row = makeSession({ status: SessionStatus.ABANDONED });
      repo.findOne.mockResolvedValue(row);

      const result = await engine.handleReconnect(
        'user-1',
        'client-session-id',
      );

      expect(result).toEqual({ abandoned: true });
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'client-session-id', userId: 'user-1' },
      });
    });

    it('(c) no store entry + COMPLETED DB row → null', async () => {
      const row = makeSession({ status: SessionStatus.COMPLETED });
      repo.findOne.mockResolvedValue(row);

      const result = await engine.handleReconnect(
        'user-1',
        'client-session-id',
      );

      expect(result).toBeNull();
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'client-session-id', userId: 'user-1' },
      });
    });

    it('(d) no store entry + missing DB row (findOne → null) → null', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await engine.handleReconnect(
        'user-1',
        'client-session-id',
      );

      expect(result).toBeNull();
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'client-session-id', userId: 'user-1' },
      });
    });

    it('(e) no clientSessionId → null, findOne not called', async () => {
      const result = await engine.handleReconnect('user-1');

      expect(result).toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('ensureRoot', () => {
    it('concurrent calls create exactly one root row (repo.create and repo.save called once)', async () => {
      const rootSession = makeSession({
        id: 'root-1',
        activityType: ActivityType.ROOT,
        rootSessionId: null,
      });
      repo.create.mockImplementation((e: Partial<ModuleSession>) => e);
      repo.save.mockResolvedValue(rootSession);

      const [a, b] = await Promise.all([
        engine.ensureRoot('u'),
        engine.ensureRoot('u'),
      ]);

      // Primary discriminator: only one DB round-trip
      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(repo.save).toHaveBeenCalledTimes(1);
      // Secondary: both callers receive the same root
      expect(a.id).toBe('root-1');
      expect(b.id).toBe('root-1');
    });

    it('returns synthesized root without DB access when root already exists in store', async () => {
      const now = new Date();
      // Pre-seed via the real store so both getRoot and getRootId are consistent
      activitySessionStore.setRoot('u', 'existing-root', {
        sessionId: 'existing-root',
        activityType: ActivityType.ROOT,
        startedAt: now,
        lastActivityAt: now,
        isPaused: false,
        rootSessionId: null,
      });

      const result = await engine.ensureRoot('u');

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(result.id).toBe('existing-root');
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

  // ── connection-loss: scaffolding + characterization + RED targets ─────────

  describe('connection-loss', () => {
    const userId = 'user-multi';
    const rootId = 'root-session-1';
    const childId1 = 'child-session-1';
    const childId2 = 'child-session-2';

    // Fake timers prevent handleTransportDisconnect's real 30 s grace timers
    // from dangling after each test. Timers are cleared and restored in afterEach.
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    /** Seed root + 2 children into the real ActivitySessionStore. */
    function seedMultiSession(): void {
      const now = new Date();
      activitySessionStore.setRoot(userId, rootId, {
        sessionId: rootId,
        activityType: ActivityType.ROOT,
        rootSessionId: null,
        startedAt: now,
        lastActivityAt: now,
        isPaused: false,
      });
      activitySessionStore.addChild(userId, childId1, {
        sessionId: childId1,
        activityType: ActivityType.BREATH,
        rootSessionId: rootId,
        startedAt: now,
        lastActivityAt: now,
        isPaused: false,
      });
      activitySessionStore.addChild(userId, childId2, {
        sessionId: childId2,
        activityType: ActivityType.BREATH,
        rootSessionId: rootId,
        startedAt: now,
        lastActivityAt: now,
        isPaused: false,
      });
    }

    // ── Phase 1: Characterization — locked current behavior ──────────────────
    // These must stay GREEN now AND after spec 23-connection-loss-markers.
    // A failure here after spec 23 is a genuine regression — escalate.

    describe('characterization — locked current behavior', () => {
      it('handleTransportDisconnect calls repo.update with DISCONNECTED + disconnectedAt for root and each child, and arms a grace timer per session', async () => {
        seedMultiSession();
        repo.update.mockResolvedValue({});

        await engine.handleTransportDisconnect(userId);

        expect(repo.update).toHaveBeenCalledWith(
          rootId,
          expect.objectContaining({
            status: SessionStatus.DISCONNECTED,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            disconnectedAt: expect.any(Date),
          }),
        );
        expect(repo.update).toHaveBeenCalledWith(
          childId1,
          expect.objectContaining({
            status: SessionStatus.DISCONNECTED,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            disconnectedAt: expect.any(Date),
          }),
        );
        expect(repo.update).toHaveBeenCalledWith(
          childId2,
          expect.objectContaining({
            status: SessionStatus.DISCONNECTED,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            disconnectedAt: expect.any(Date),
          }),
        );

        expect(
          activitySessionStore.hasPendingGraceTimerForSession(rootId),
        ).toBe(true);
        expect(
          activitySessionStore.hasPendingGraceTimerForSession(childId1),
        ).toBe(true);
        expect(
          activitySessionStore.hasPendingGraceTimerForSession(childId2),
        ).toBe(true);

        // Explicit cancel per grace-timer hygiene (afterEach clears as backup)
        activitySessionStore.cancelGraceTimerForSession(rootId);
        activitySessionStore.cancelGraceTimerForSession(childId1);
        activitySessionStore.cancelGraceTimerForSession(childId2);
      });

      it('abandonStale: stale ACTIVE row with disconnectedAt=null saves endedAt ≈ now (now fallback survives)', async () => {
        const session = makeSession({
          status: SessionStatus.ACTIVE,
          disconnectedAt: null,
        });
        repo.findOne.mockResolvedValue(session);
        repo.save.mockImplementation((s: ModuleSession) =>
          Promise.resolve({ ...s }),
        );

        const before = Date.now();
        await engine.abandonStale('user-1', 'session-1');
        const after = Date.now();

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const savedArg: ModuleSession = repo.save.mock.calls[0][0];
        expect(savedArg.endedAt).toEqual(expect.any(Date));
        expect(savedArg.endedAt!.getTime()).toBeGreaterThanOrEqual(before);
        expect(savedArg.endedAt!.getTime()).toBeLessThanOrEqual(after);
      });

      it('startActivity pushes SESSION_EVENT / STARTED on the new session id', async () => {
        const dto: ActivityStartDto = { activityType: ActivityType.BREATH };
        const session = makeSession();
        repo.create.mockReturnValue(session);
        repo.save.mockResolvedValue(session);

        await engine.startActivity('user-1', dto);

        expect(streamEngine.push).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({
            data: expect.objectContaining({
              dataType: StreamDataType.SESSION_EVENT,
              event: StreamSessionEvent.STARTED,
            }),
          }),
        );
      });

      it('endActivity pushes SESSION_EVENT / ENDED on the session id', async () => {
        const session = makeSession();
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

        await engine.endActivity('user-1');

        expect(streamEngine.push).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({
            data: expect.objectContaining({
              dataType: StreamDataType.SESSION_EVENT,
              event: StreamSessionEvent.ENDED,
            }),
          }),
        );
      });

      it('abandonActivity pushes SESSION_EVENT / ABANDONED on the session id', async () => {
        const session = makeSession({ status: SessionStatus.DISCONNECTED });
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

        await engine.abandonActivity('user-1');

        expect(streamEngine.push).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({
            data: expect.objectContaining({
              dataType: StreamDataType.SESSION_EVENT,
              event: StreamSessionEvent.ABANDONED,
            }),
          }),
        );
      });

      it('pauseActivity pushes SESSION_EVENT / PAUSED on the child session id', () => {
        const now = new Date();
        activitySessionStore.addChild('user-1', 'session-1', {
          sessionId: 'session-1',
          activityType: ActivityType.BREATH,
          startedAt: now,
          lastActivityAt: now,
          isPaused: false,
        });

        engine.pauseActivity('user-1', 'session-1');

        expect(streamEngine.push).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({
            data: expect.objectContaining({
              dataType: StreamDataType.SESSION_EVENT,
              event: StreamSessionEvent.PAUSED,
            }),
          }),
        );
      });

      it('unpauseActivity pushes SESSION_EVENT / RESUMED on the child session id', () => {
        const now = new Date();
        activitySessionStore.addChild('user-1', 'session-1', {
          sessionId: 'session-1',
          activityType: ActivityType.BREATH,
          startedAt: now,
          lastActivityAt: now,
          isPaused: true,
        });

        engine.unpauseActivity('user-1', 'session-1');

        expect(streamEngine.push).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({
            data: expect.objectContaining({
              dataType: StreamDataType.SESSION_EVENT,
              event: StreamSessionEvent.RESUMED,
            }),
          }),
        );
      });
    });

    // ── Phase 2: Target tests — RED until spec 23-connection-loss-markers ─────
    // These tests define the desired behavior for spec 23. They MUST fail
    // (RED) when committed now, and turn GREEN once spec 23 lands.
    // Do NOT weaken assertions if they remain RED after spec 23 — escalate.

    describe('RED until spec 23-connection-loss-markers', () => {
      it('handleTransportDisconnect emits exactly one disconnected event keyed to rootId — never per-child (spam guard)', async () => {
        seedMultiSession();
        repo.update.mockResolvedValue({});

        await engine.handleTransportDisconnect(userId);

        // Use literal string: StreamSessionEvent.DISCONNECTED does not exist yet
        // (stream-data-types.ts will add it in spec 23)
        const disconnectedCalls = streamEngine.push.mock.calls.filter(
          ([, payload]) =>
            (payload as { data?: { event?: string } })?.data?.event ===
            'disconnected',
        );
        expect(disconnectedCalls).toHaveLength(1);
        expect(disconnectedCalls[0][0]).toBe(rootId);
        expect(disconnectedCalls[0][1]).toMatchObject({
          data: { dataType: StreamDataType.SESSION_EVENT },
        });

        activitySessionStore.cancelGraceTimerForSession(rootId);
        activitySessionStore.cancelGraceTimerForSession(childId1);
        activitySessionStore.cancelGraceTimerForSession(childId2);
      });

      it('handleReconnect emits exactly one reconnected event keyed to rootId', async () => {
        seedMultiSession();
        const disconnectedAt = new Date(Date.now() - 5_000);
        repo.findOne.mockImplementation((options: any) =>
          Promise.resolve(
            makeSession({
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              id: options.where.id as string,
              status: SessionStatus.DISCONNECTED,
              disconnectedAt,
            }),
          ),
        );
        repo.save.mockImplementation((s: ModuleSession) =>
          Promise.resolve({
            ...s,
            status: SessionStatus.ACTIVE,
            disconnectedAt: null,
          }),
        );

        await engine.handleReconnect(userId, 'client-session-id');

        // Use literal string: StreamSessionEvent.RECONNECTED does not exist yet
        const reconnectedCalls = streamEngine.push.mock.calls.filter(
          ([, payload]) =>
            (payload as { data?: { event?: string } })?.data?.event ===
            'reconnected',
        );
        expect(reconnectedCalls).toHaveLength(1);
        expect(reconnectedCalls[0][0]).toBe(rootId);
        expect(reconnectedCalls[0][1]).toMatchObject({
          data: { dataType: StreamDataType.SESSION_EVENT },
        });
      });

      it('abandonActivity uses disconnectedAt as endedAt — not now — for a DISCONNECTED session', async () => {
        const disconnectedAt = new Date(Date.now() - 30_000);
        const now = new Date();
        activitySessionStore.addChild('user-1', 'session-1', {
          sessionId: 'session-1',
          activityType: ActivityType.BREATH,
          startedAt: now,
          lastActivityAt: now,
          isPaused: false,
        });
        const session = makeSession({
          status: SessionStatus.DISCONNECTED,
          disconnectedAt,
        });
        repo.findOne.mockResolvedValue(session);
        let savedArg: ModuleSession | undefined;
        repo.save.mockImplementation((s: ModuleSession) => {
          savedArg = { ...s };
          return Promise.resolve(savedArg);
        });

        await engine.abandonActivity('user-1', 'session-1');

        // spec 23 will change line ~339: `session.endedAt = disconnectedAt ?? now`
        // Until then: endedAt = now (not disconnectedAt) → RED
        expect(savedArg).toBeDefined();
        expect(savedArg!.endedAt).toEqual(disconnectedAt);
      });
    });
  });

  // ── Pause/unpause guard characterization ─────────────────────────────────
  // These must pass NOW and stay GREEN after spec 24-pause-state-integrity.
  // A failure here after spec 24 is a regression — escalate, do not weaken.

  describe('pause/unpause guards — characterization', () => {
    it('pauseActivity throws ALREADY_PAUSED when the child session is already paused', () => {
      const now = new Date();
      activitySessionStore.addChild('user-1', 'session-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        rootSessionId: null,
        startedAt: now,
        lastActivityAt: now,
        isPaused: true,
      });

      expect(() => engine.pauseActivity('user-1', 'session-1')).toThrow(
        WsErrorCode.ALREADY_PAUSED,
      );
    });

    it('unpauseActivity throws NOT_PAUSED when the child session is not paused', () => {
      const now = new Date();
      activitySessionStore.addChild('user-1', 'session-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        rootSessionId: null,
        startedAt: now,
        lastActivityAt: now,
        isPaused: false,
      });

      expect(() => engine.unpauseActivity('user-1', 'session-1')).toThrow(
        WsErrorCode.NOT_PAUSED,
      );
    });

    it('pauseActivity on a non-paused child writes isPaused = true in the store', () => {
      const now = new Date();
      activitySessionStore.addChild('user-1', 'session-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        rootSessionId: null,
        startedAt: now,
        lastActivityAt: now,
        isPaused: false,
      });

      engine.pauseActivity('user-1', 'session-1');

      expect(
        activitySessionStore.getSession('user-1', 'session-1')?.isPaused,
      ).toBe(true);
    });

    it('unpauseActivity on a paused child writes isPaused = false in the store', () => {
      const now = new Date();
      activitySessionStore.addChild('user-1', 'session-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        rootSessionId: null,
        startedAt: now,
        lastActivityAt: now,
        isPaused: true,
      });

      engine.unpauseActivity('user-1', 'session-1');

      expect(
        activitySessionStore.getSession('user-1', 'session-1')?.isPaused,
      ).toBe(false);
    });
  });

  // ── Pause integrity across reconnect — RED until spec 24 ─────────────────
  // These tests define the target behavior fixed by spec 24-pause-state-integrity.
  // They MUST fail (RED) now because resumeActivity unconditionally resets
  // state.isPaused = false. Do NOT weaken or skip after spec 24 — escalate if
  // they remain RED once the fix lands.

  describe('pause integrity across resume — RED until spec 24-pause-state-integrity', () => {
    it('Case A — resume preserves pause: resumeActivity must not reset isPaused when session was paused before reconnect', async () => {
      const startedAt = new Date();
      const lastActivityAt = new Date();
      activitySessionStore.addChild('user-1', 'session-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        rootSessionId: null,
        startedAt,
        lastActivityAt,
        isPaused: true,
      });
      repo.findOne.mockResolvedValue(
        makeSession({ status: SessionStatus.DISCONNECTED }),
      );
      repo.save.mockImplementation((s: ModuleSession) =>
        Promise.resolve({ ...s }),
      );

      await engine.resumeActivity('user-1', 'session-1');

      // RED until spec 24-pause-state-integrity:
      // resumeActivity currently hard-resets state.isPaused = false → expect true after fix
      expect(
        activitySessionStore.getSession('user-1', 'session-1')?.isPaused,
      ).toBe(true);
    });

    it('Case B — unpause succeeds after resume: NOT_PAUSED must not fire when session was paused before reconnect', async () => {
      const startedAt = new Date();
      const lastActivityAt = new Date();
      activitySessionStore.addChild('user-1', 'session-1', {
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        rootSessionId: null,
        startedAt,
        lastActivityAt,
        isPaused: true,
      });
      repo.findOne.mockResolvedValue(
        makeSession({ status: SessionStatus.DISCONNECTED }),
      );
      repo.save.mockImplementation((s: ModuleSession) =>
        Promise.resolve({ ...s }),
      );

      await engine.resumeActivity('user-1', 'session-1');

      // RED until spec 24-pause-state-integrity:
      // after the buggy reset, isPaused=false → unpauseActivity throws NOT_PAUSED
      expect(() =>
        engine.unpauseActivity('user-1', 'session-1'),
      ).not.toThrow();
    });
  });
});
