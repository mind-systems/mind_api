/**
 * Multi-session lifecycle state machine — test contract
 *
 * RED/GREEN CLASSIFICATION
 * ========================
 *
 * CHARACTERIZATION tests (marked "[GREEN now, must survive Phase 55]")
 *   Assert current single-session behavior that Phase 55 (03-multi-session-store-engine)
 *   is declared to preserve unchanged. Any RED here after the Phase 55 refactor is a
 *   Class B silent regression — escalate immediately, do NOT patch the test.
 *
 * TARGET tests (marked "[RED until Phase 55]" or "[RED until Phase 55 — lazy-root-creation / spec 04]")
 *   Assert the new per-session behavior (multi-session store, sessionId-keyed grace timers,
 *   ensureRoot, rootSessionId linking). These are expected RED now and turn GREEN only when
 *   their Phase 55 feature spec lands. Do NOT .skip/.todo/it.failing them and do NOT implement
 *   the feature here — genuine red-for-the-right-reason is the done state. CI will show these
 *   as failing until Phase 55 lands; that is the intended TDD signal.
 */

import { ActivityEngine } from './activity-engine.service';
import { ActivitySessionStore } from './activity-session-store.service';
import { ActivityType } from '../enums/activity-type.enum';
import { SessionStatus } from '../enums/session-status.enum';
import { ActivityStartDto } from '../dto/activity-start.dto';
import { ModuleSession } from '../entities/module-session.entity';
import { ActivityState } from '../interfaces/activity-state.interface';
import { SessionEvents } from '../events/session.events';
import {
  MODULE_SESSION_PAUSED,
  MODULE_SESSION_UNPAUSED,
} from '../events/module-session.events';
import {
  StreamDataType,
  StreamSessionEvent,
} from '../constants/stream-data-types';

// ── Shared fixtures ──────────────────────────────────────────────────────────

function makeStore(graceMs?: number): ActivitySessionStore {
  const configService = {
    get: jest.fn().mockReturnValue(graceMs),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return new ActivitySessionStore(configService as any);
}

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

function makeState(overrides: Partial<ActivityState> = {}): ActivityState {
  const now = new Date();
  return {
    sessionId: 'session-1',
    activityType: ActivityType.BREATH,
    startedAt: now,
    lastActivityAt: now,
    isPaused: false,
    ...overrides,
  };
}

// ── Thin wrapper helpers (single point Phase 55 will update) ─────────────────
//
// These wrappers forward to the current single-userId engine signatures.
// When Phase 55 threads an explicit sessionId through the method signatures,
// only these helper bodies change (mechanical, loud, compile-checked) —
// the assertions in characterization tests do not change.
//
// CRITICAL: `disconnect` forwards to handleTransportDisconnect (which calls
// onDisconnect AND starts the grace timer) — NOT onDisconnect alone (which
// never schedules a timer). The grace timer must be scheduled for the
// disconnect→grace→abandon and disconnect→reconnect-in-grace flows to work.
//
// `reconnect` forwards to handleReconnect (cancels the timer + resumes).

function makeHelpers(engine: ActivityEngine) {
  return {
    start: (userId: string, dto: ActivityStartDto) =>
      engine.startActivity(userId, dto),
    end: (userId: string, clientTimestampMs?: number) =>
      engine.endActivity(userId, undefined, clientTimestampMs),
    stop: (userId: string) => engine.stopActivity(userId),
    disconnect: (userId: string) => engine.handleTransportDisconnect(userId),
    reconnect: (userId: string, clientSessionId?: string) =>
      engine.handleReconnect(userId, clientSessionId),
    pause: (userId: string) => engine.pauseActivity(userId),
    unpause: (userId: string) => engine.unpauseActivity(userId),
    abandonStale: (userId: string, sessionId: string) =>
      engine.abandonStale(userId, sessionId),
  };
}

// ── Phase 1: Store-level state machine ───────────────────────────────────────

describe('characterization — store [GREEN now, must survive Phase 55]', () => {
  let store: ActivitySessionStore;

  beforeEach(() => {
    jest.useFakeTimers();
    store = makeStore(1_000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('set/get/has/delete round-trip for one userId', () => {
    const state = makeState({ sessionId: 'session-abc' });
    store.set('user-1', state);
    expect(store.has('user-1')).toBe(true);
    expect(store.get('user-1')).toBe(state);
    const deleted = store.delete('user-1');
    expect(deleted).toBe(true);
    expect(store.has('user-1')).toBe(false);
    expect(store.get('user-1')).toBeUndefined();
  });
  // Grace-timer semantics (firing, hasPendingGraceTimer, cancelGraceTimer) are
  // already covered exhaustively in activity-session-store.service.spec.ts.
  // Phase 55 re-keys timers from userId to sessionId, so any userId-keyed timer
  // assertions here would go RED at Phase 55 for the intended reason — tripping
  // the file's own "red = escalate, never patch" contract incorrectly.
});

describe('target — multi-session store [RED until Phase 55]', () => {
  let store: ActivitySessionStore;

  beforeEach(() => {
    jest.useFakeTimers();
    store = makeStore(1_000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should store and retrieve multiple children under one userId (addChild/getChild/listChildren)', () => {
    const stateA = makeState({ sessionId: 'session-A' });
    const stateB = makeState({ sessionId: 'session-B' });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).addChild('user-1', 'session-A', stateA);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).addChild('user-1', 'session-B', stateB);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect((store as any).getChild('user-1', 'session-A')).toBe(stateA);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect((store as any).getChild('user-1', 'session-B')).toBe(stateB);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const children = (store as any).listChildren('user-1') as ActivityState[];
    expect(children).toHaveLength(2);
    expect(children).toContain(stateA);
    expect(children).toContain(stateB);
  });

  it('should key grace timers by sessionId, not userId: two children expire independently', () => {
    const cbA = jest.fn();
    const cbB = jest.fn();

    // Start timer for session-A at t=0 (fires at t=1000)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).startGraceTimerForSession('session-A', cbA);

    // Advance halfway — session-A's timer has not fired
    jest.advanceTimersByTime(500);
    expect(cbA).not.toHaveBeenCalled();

    // Start timer for session-B at t=500 (fires at t=1500 from original zero)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).startGraceTimerForSession('session-B', cbB);

    // Advance to t=1000 — session-A fires, session-B still pending
    jest.advanceTimersByTime(500);
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect((store as any).hasPendingGraceTimerForSession('session-B')).toBe(
      true,
    );

    // Advance to t=1500 — session-B fires
    jest.advanceTimersByTime(500);
    expect(cbB).toHaveBeenCalledTimes(1);
  });

  it('sole-child resolution accessor returns the single child (new resolution over children map, RED today)', () => {
    const state = makeState({ sessionId: 'session-X' });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).addChild('user-1', 'session-X', state);

    // This is the new convenience accessor that resolves the one live child
    // out of the per-user children map — replaces the old get(userId) for
    // callers that relied on single-session semantics.
    // RED today: the method does not exist, so this throws at runtime.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolved = (store as any).getSoleChild('user-1') as ActivityState;
    expect(resolved).toBe(state);
  });
});

// ── Phase 2: Engine lifecycle + root linking ──────────────────────────────────

describe('characterization — engine [GREEN now, must survive Phase 55]', () => {
  let engine: ActivityEngine;
  let store: ActivitySessionStore;
  let repo: ReturnType<typeof makeRepo>;
  let emitter: ReturnType<typeof makeEmitter>;
  let streamEngine: ReturnType<typeof makeStreamEngine>;
  let h: ReturnType<typeof makeHelpers>;

  beforeEach(() => {
    jest.useFakeTimers();
    store = makeStore(1_000);
    repo = makeRepo();
    emitter = makeEmitter();
    streamEngine = makeStreamEngine();
    engine = new ActivityEngine(
      repo as any,
      store,
      emitter as any,
      streamEngine as any,
    );
    h = makeHelpers(engine);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── start → end ──────────────────────────────────────────────────────────

  it('start→end: child becomes completed with endedAt set, store cleared, COMPLETED emitted, push ENDED', async () => {
    const session = makeSession();
    repo.create.mockReturnValue(session);
    repo.save.mockResolvedValueOnce(session); // startActivity save

    await h.start('user-1', { activityType: ActivityType.BREATH });

    const savedEnd = {
      ...session,
      status: SessionStatus.COMPLETED,
      endedAt: new Date(),
    };
    repo.findOne.mockResolvedValue(session);
    repo.save.mockResolvedValueOnce(savedEnd);

    await h.end('user-1');

    expect(session.status).toBe(SessionStatus.COMPLETED);
    expect(session.endedAt).toBeDefined();
    expect(store.has('user-1')).toBe(false);

    expect(emitter.emit).toHaveBeenCalledWith(
      SessionEvents.COMPLETED,
      expect.objectContaining({
        sessionId: session.id,
        userId: 'user-1',
        activityType: ActivityType.BREATH,
      }),
    );

    expect(streamEngine.push).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        data: expect.objectContaining({
          dataType: StreamDataType.SESSION_EVENT,
          event: StreamSessionEvent.ENDED,
        }),
      }),
    );
  });

  // ── start → stop ─────────────────────────────────────────────────────────

  it('start→stop: interrupted + endedAt set, INTERRUPTED emitted, push INTERRUPTED', async () => {
    const session = makeSession();
    repo.create.mockReturnValue(session);
    repo.save.mockResolvedValueOnce(session);

    await h.start('user-1', { activityType: ActivityType.BREATH });

    const savedStop = {
      ...session,
      status: SessionStatus.INTERRUPTED,
      endedAt: new Date(),
    };
    repo.findOne.mockResolvedValue(session);
    repo.save.mockResolvedValueOnce(savedStop);

    await h.stop('user-1');

    expect(session.status).toBe(SessionStatus.INTERRUPTED);
    expect(session.endedAt).toBeDefined();
    expect(store.has('user-1')).toBe(false);

    expect(emitter.emit).toHaveBeenCalledWith(
      SessionEvents.INTERRUPTED,
      expect.objectContaining({
        sessionId: session.id,
        userId: 'user-1',
        activityType: ActivityType.BREATH,
      }),
    );

    expect(streamEngine.push).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        data: expect.objectContaining({
          dataType: StreamDataType.SESSION_EVENT,
          event: StreamSessionEvent.INTERRUPTED,
        }),
      }),
    );
  });

  // ── disconnect → grace → abandon ─────────────────────────────────────────

  it('disconnect→grace→abandon: sets disconnected via repo.update; advancing past graceMs abandons session, store cleared, ABANDONED emitted', async () => {
    const session = makeSession({ status: SessionStatus.DISCONNECTED });
    store.set('user-1', makeState({ sessionId: 'session-1' }));
    repo.update.mockResolvedValue(undefined);

    await h.disconnect('user-1');

    expect(repo.update).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        status: SessionStatus.DISCONNECTED,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        disconnectedAt: expect.any(Date),
      }),
    );

    // Advance past graceMs — abandonActivity runs
    const savedAbandoned = {
      ...session,
      status: SessionStatus.ABANDONED,
      endedAt: new Date(),
    };
    repo.findOne.mockResolvedValue(session);
    repo.save.mockResolvedValue(savedAbandoned);

    jest.advanceTimersByTime(1_000);
    // Flush async microtasks from the abandon callback
    await Promise.resolve();
    await Promise.resolve();

    expect(session.status).toBe(SessionStatus.ABANDONED);
    expect(session.endedAt).toBeDefined();
    expect(store.has('user-1')).toBe(false);

    expect(emitter.emit).toHaveBeenCalledWith(
      SessionEvents.ABANDONED,
      expect.objectContaining({
        sessionId: session.id,
        userId: 'user-1',
      }),
    );

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

  // ── disconnect → reconnect-in-grace → resume ─────────────────────────────

  it('disconnect→reconnect-in-grace→resume: reconnect before grace fires cancels timer and resumes to active, ABANDONED never emitted', async () => {
    const disconnectedSession = makeSession({
      status: SessionStatus.DISCONNECTED,
    });
    store.set('user-1', makeState({ sessionId: 'session-1' }));
    repo.update.mockResolvedValue(undefined);

    await h.disconnect('user-1');

    // Reconnect before grace fires (advance only half the grace period)
    jest.advanceTimersByTime(500);

    const resumedSession = {
      ...disconnectedSession,
      status: SessionStatus.ACTIVE,
      disconnectedAt: null,
    };
    repo.findOne.mockResolvedValue(disconnectedSession);
    repo.save.mockResolvedValue(resumedSession);

    await h.reconnect('user-1', 'session-1');

    // Session is back to active, disconnectedAt cleared
    expect(disconnectedSession.status).toBe(SessionStatus.ACTIVE);
    expect(disconnectedSession.disconnectedAt).toBeNull();

    // Advance past original grace deadline — no ABANDONED emitted.
    // Note: this assertion does NOT prove timer cancellation. Even if reconnect
    // failed to cancel the grace timer and it fired, abandonActivity would read
    // the now-ACTIVE row and the status-guard (activity-engine.service.ts:197–200)
    // short-circuits without emitting ABANDONED. Timer-cancellation coverage lives
    // in the sessionId-keyed target block (lines ~580–590) and in
    // activity-session-store.service.spec.ts (post-Phase-55).
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(emitter.emit).not.toHaveBeenCalledWith(
      SessionEvents.ABANDONED,
      expect.anything(),
    );
  });

  // ── pause / unpause ───────────────────────────────────────────────────────

  it('pause/resume (unpause): isPaused toggles, push emits PAUSED/RESUMED, MODULE_SESSION_PAUSED/UNPAUSED emitted', () => {
    store.set('user-1', makeState({ sessionId: 'session-1', isPaused: false }));

    const pausedState = h.pause('user-1');
    expect(pausedState.isPaused).toBe(true);

    expect(streamEngine.push).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        data: expect.objectContaining({
          dataType: StreamDataType.SESSION_EVENT,
          event: StreamSessionEvent.PAUSED,
        }),
      }),
    );
    expect(emitter.emit).toHaveBeenCalledWith(
      MODULE_SESSION_PAUSED,
      expect.objectContaining({ sessionId: 'session-1', userId: 'user-1' }),
    );

    const unpausedState = h.unpause('user-1');
    expect(unpausedState.isPaused).toBe(false);

    expect(streamEngine.push).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        data: expect.objectContaining({
          dataType: StreamDataType.SESSION_EVENT,
          event: StreamSessionEvent.RESUMED,
        }),
      }),
    );
    expect(emitter.emit).toHaveBeenCalledWith(
      MODULE_SESSION_UNPAUSED,
      expect.objectContaining({ sessionId: 'session-1', userId: 'user-1' }),
    );
  });

  // ── abandon no-ops when already resumed ──────────────────────────────────

  it('abandon no-ops when session is already ACTIVE (reconnect beat the grace timer): no save, no emit, store cleared', async () => {
    const activeSession = makeSession({ status: SessionStatus.ACTIVE });
    store.set('user-1', makeState({ sessionId: 'session-1' }));
    repo.findOne.mockResolvedValue(activeSession);

    await engine.abandonActivity('user-1');

    expect(repo.save).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
    expect(store.has('user-1')).toBe(false);
  });

  // ── coerceClientTs Long branch ────────────────────────────────────────────

  it('coerceClientTs Long branch on startActivity: Long.toNumber() value is used as startedAt, lastActivityAt stays server-clocked', async () => {
    const clientMs = Date.now() - 5_000;
    const longLike = { toNumber: () => clientMs };
    const dto: ActivityStartDto = {
      activityType: ActivityType.BREATH,
      clientTimestampMs: longLike as any,
    };

    let capturedCreate: Partial<ModuleSession> | undefined;
    repo.create.mockImplementation((data: Partial<ModuleSession>) => {
      capturedCreate = data;
      return { ...makeSession(), ...data };
    });
    repo.save.mockImplementation((s: ModuleSession) =>
      Promise.resolve({ ...s }),
    );

    const before = Date.now();
    await h.start('user-1', dto);
    const after = Date.now();

    expect(capturedCreate).toBeDefined();
    // startedAt uses the Long value
    expect(capturedCreate!.startedAt).toEqual(new Date(clientMs));
    // lastActivityAt is server-clocked (not the client value)
    expect(capturedCreate!.lastActivityAt).toBeDefined();
    expect(capturedCreate!.lastActivityAt!.getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(capturedCreate!.lastActivityAt!.getTime()).toBeLessThanOrEqual(
      after,
    );
    expect(capturedCreate!.lastActivityAt!.getTime()).not.toBe(clientMs);
  });

  it('coerceClientTs Long branch on endActivity: Long.toNumber() value is used as endedAt when >= startedAt', async () => {
    const startedAt = new Date(Date.now() - 10_000);
    const session = makeSession({ startedAt });
    store.set('user-1', makeState({ sessionId: 'session-1', startedAt }));

    // clientEnd is 8s after startedAt — valid
    const clientEndMs = startedAt.getTime() + 8_000;
    const longLike = { toNumber: () => clientEndMs };

    repo.findOne.mockResolvedValue(session);
    repo.save.mockImplementation((s: ModuleSession) =>
      Promise.resolve({ ...s }),
    );

    await h.end('user-1', longLike as any);

    expect(session.endedAt).toEqual(new Date(clientEndMs));
  });
});

describe('target — engine multi-session [RED until Phase 55]', () => {
  let engine: ActivityEngine;
  let store: ActivitySessionStore;
  let repo: ReturnType<typeof makeRepo>;
  let emitter: ReturnType<typeof makeEmitter>;
  let streamEngine: ReturnType<typeof makeStreamEngine>;
  let h: ReturnType<typeof makeHelpers>;

  beforeEach(() => {
    jest.useFakeTimers();
    store = makeStore(1_000);
    repo = makeRepo();
    emitter = makeEmitter();
    streamEngine = makeStreamEngine();
    engine = new ActivityEngine(
      repo as any,
      store,
      emitter as any,
      streamEngine as any,
    );
    h = makeHelpers(engine);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('transport disconnect moves EVERY live session of a user to disconnected — each with its own per-session grace timer', async () => {
    // Seed root + two children in the store via future API
    const rootState = makeState({ sessionId: 'session-root' });
    const childAState = makeState({ sessionId: 'session-A' });
    const childBState = makeState({ sessionId: 'session-B' });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).setRoot('user-1', 'session-root', rootState);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).addChild('user-1', 'session-A', childAState);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).addChild('user-1', 'session-B', childBState);

    repo.update.mockResolvedValue(undefined);

    await h.disconnect('user-1');

    // All three sessions must be updated to DISCONNECTED
    expect(repo.update).toHaveBeenCalledWith(
      'session-root',
      expect.objectContaining({ status: SessionStatus.DISCONNECTED }),
    );
    expect(repo.update).toHaveBeenCalledWith(
      'session-A',
      expect.objectContaining({ status: SessionStatus.DISCONNECTED }),
    );
    expect(repo.update).toHaveBeenCalledWith(
      'session-B',
      expect.objectContaining({ status: SessionStatus.DISCONNECTED }),
    );

    // Each session has its own grace timer keyed by sessionId
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect((store as any).hasPendingGraceTimerForSession('session-root')).toBe(
      true,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect((store as any).hasPendingGraceTimerForSession('session-A')).toBe(
      true,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect((store as any).hasPendingGraceTimerForSession('session-B')).toBe(
      true,
    );
  });

  it('reconnect in grace resumes EVERY disconnected session of the user (root + all children back to active)', async () => {
    const rootSession = makeSession({
      id: 'session-root',
      status: SessionStatus.DISCONNECTED,
    });
    const childASession = makeSession({
      id: 'session-A',
      status: SessionStatus.DISCONNECTED,
    });
    const childBSession = makeSession({
      id: 'session-B',
      status: SessionStatus.DISCONNECTED,
    });

    const rootState = makeState({ sessionId: 'session-root' });
    const childAState = makeState({ sessionId: 'session-A' });
    const childBState = makeState({ sessionId: 'session-B' });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).setRoot('user-1', 'session-root', rootState);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).addChild('user-1', 'session-A', childAState);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).addChild('user-1', 'session-B', childBState);

    // Seed per-session grace timers
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).startGraceTimerForSession('session-root', jest.fn());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).startGraceTimerForSession('session-A', jest.fn());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).startGraceTimerForSession('session-B', jest.fn());

    repo.findOne.mockImplementation(
      ({ where: { id } }: { where: { id: string } }) => {
        if (id === 'session-root') return Promise.resolve(rootSession);
        if (id === 'session-A') return Promise.resolve(childASession);
        if (id === 'session-B') return Promise.resolve(childBSession);
        return Promise.resolve(null);
      },
    );
    repo.save.mockImplementation((s: ModuleSession) =>
      Promise.resolve({
        ...s,
        status: SessionStatus.ACTIVE,
        disconnectedAt: null,
      }),
    );

    await h.reconnect('user-1', 'session-root');

    // All three grace timers are cancelled
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect((store as any).hasPendingGraceTimerForSession('session-root')).toBe(
      false,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect((store as any).hasPendingGraceTimerForSession('session-A')).toBe(
      false,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect((store as any).hasPendingGraceTimerForSession('session-B')).toBe(
      false,
    );

    // All three sessions resumed to ACTIVE
    expect(rootSession.status).toBe(SessionStatus.ACTIVE);
    expect(childASession.status).toBe(SessionStatus.ACTIVE);
    expect(childBSession.status).toBe(SessionStatus.ACTIVE);
  });
});

describe('target — ensureRoot / linking [RED until Phase 55 — lazy-root-creation / spec 04]', () => {
  let engine: ActivityEngine;
  let store: ActivitySessionStore;
  let repo: ReturnType<typeof makeRepo>;
  let emitter: ReturnType<typeof makeEmitter>;
  let streamEngine: ReturnType<typeof makeStreamEngine>;

  beforeEach(() => {
    jest.useFakeTimers();
    store = makeStore(1_000);
    repo = makeRepo();
    emitter = makeEmitter();
    streamEngine = makeStreamEngine();
    engine = new ActivityEngine(
      repo as any,
      store,
      emitter as any,
      streamEngine as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should create exactly one root per connection (activityType root, rootSessionId null, status active) and reuse it on repeat calls', async () => {
    const rootRow = makeSession({
      id: 'root-session-1',
      // activityType 'root' does not exist in the enum yet — assert literal
      activityType: 'root' as any,
      status: SessionStatus.ACTIVE,
      // rootSessionId must be null (not undefined) — the entity column is nullable,
      // and expect(…).toBeNull() distinguishes null from undefined.
      rootSessionId: null,
    });
    repo.create.mockReturnValue(rootRow);
    repo.save.mockResolvedValue(rootRow);

    // First ensureRoot call creates the root
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const first = (await (engine as any).ensureRoot('user-1')) as ModuleSession;

    expect(first).toBeDefined();
    expect((first as any).activityType).toBe('root');
    expect((first as any).rootSessionId).toBeNull();
    expect(first.status).toBe(SessionStatus.ACTIVE);

    const saveCallCount = repo.save.mock.calls.length;

    // Second ensureRoot call reuses the same root — no duplicate save
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const second = (await (engine as any).ensureRoot(
      'user-1',
    )) as ModuleSession;

    expect(second).toBeDefined();
    expect(repo.save.mock.calls.length).toBe(saveCallCount); // no additional save
    expect(second.id).toBe(first.id);
  });

  it('should set a newly started child rootSessionId to the active root id', async () => {
    const rootRow = makeSession({
      id: 'root-session-1',
      activityType: 'root' as any,
      status: SessionStatus.ACTIVE,
      rootSessionId: null,
    });
    const childRow = makeSession({
      id: 'child-session-1',
      activityType: ActivityType.BREATH,
      status: SessionStatus.ACTIVE,
      rootSessionId: null, // Phase 55 sets this to 'root-session-1' before save
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).setRoot(
      'user-1',
      'root-session-1',
      makeState({ sessionId: 'root-session-1', activityType: 'root' as any }),
    );

    repo.create.mockReturnValue(childRow);
    repo.save.mockResolvedValue(childRow);

    await engine.startActivity('user-1', { activityType: ActivityType.BREATH });

    // The persisted child row must have rootSessionId = root's id
    const savedChild = repo.save.mock.calls[0][0];
    expect(savedChild.rootSessionId).toBe('root-session-1');

    // The stored ActivityState must also carry rootSessionId
    const storedState =
      store.get('user-1') ?? (store as any).getSoleChild('user-1');
    expect(storedState.rootSessionId).toBe('root-session-1');
  });

  it('should never end the root via activity:end — only the addressed child ends, root stays active', async () => {
    const rootRow = makeSession({
      id: 'root-session-1',
      activityType: 'root' as any,
      status: SessionStatus.ACTIVE,
      rootSessionId: null,
    });
    const childRow = makeSession({
      id: 'child-session-1',
      activityType: ActivityType.BREATH,
      status: SessionStatus.ACTIVE,
      rootSessionId: 'root-session-1',
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).setRoot(
      'user-1',
      'root-session-1',
      makeState({ sessionId: 'root-session-1', activityType: 'root' as any }),
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (store as any).addChild(
      'user-1',
      'child-session-1',
      makeState({ sessionId: 'child-session-1' }),
    );

    repo.findOne.mockImplementation(
      ({ where: { id } }: { where: { id: string } }) => {
        if (id === 'child-session-1') return Promise.resolve(childRow);
        if (id === 'root-session-1') return Promise.resolve(rootRow);
        return Promise.resolve(null);
      },
    );
    repo.save.mockImplementation((s: ModuleSession) =>
      Promise.resolve({ ...s }),
    );

    // End addresses the child, not the root
    await engine.endActivity('user-1');

    // Child is ended
    expect(childRow.status).toBe(SessionStatus.COMPLETED);
    expect(childRow.endedAt).toBeDefined();

    // Root stays active — no COMPLETED emitted for it, no save targeting the root
    expect(rootRow.status).toBe(SessionStatus.ACTIVE);
    expect(rootRow.endedAt).toBeUndefined();

    const completedEmits = emitter.emit.mock.calls.filter(
      ([event]: [string]) => event === SessionEvents.COMPLETED,
    );
    expect(completedEmits).toHaveLength(1);
    expect(completedEmits[0][1]).toMatchObject({
      sessionId: 'child-session-1',
    });
  });
});
