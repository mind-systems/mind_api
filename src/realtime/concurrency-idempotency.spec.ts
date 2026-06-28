/**
 * Concurrent activities + idempotency dedup — test contract
 *
 * RED/GREEN CLASSIFICATION
 * ========================
 *
 * TARGET tests (marked "[TARGET — RED until spec 06-state-controller-concurrent-idempotency]")
 *   Assert new behavior that lands with spec 06 (proto dependency: 05-proto-session-id-idempotency).
 *   Do NOT .skip/.todo/it.failing them — genuine red-for-the-right-reason is the done state.
 *   CI shows these as failing until spec 06 lands; that is the intended TDD signal.
 *
 * CHARACTERIZATION tests (marked "[CHARACTERIZATION — GREEN now, must survive spec 06]")
 *   Assert behavior that already holds today and that spec 06 must preserve unchanged.
 *   Any RED here after spec 06 lands is a Class B silent regression — escalate immediately,
 *   do NOT patch the test.
 *
 * COMPILE-BEFORE-FEATURE DISCIPLINE
 * ==================================
 * This file must NOT import or reference any symbol added by specs 05/06.
 * Not-yet-existing proto fields are accessed via (cmd as any).clientActivityId / (cmd as any).sessionId.
 * Not-yet-existing engine methods are accessed via (engine as any).<method>.
 * The new error code is referenced as the STRING LITERAL 'AMBIGUOUS_SESSION' (never the constant).
 * The new config key is referenced as the STRING LITERAL 'WS_IDEMPOTENCY_WINDOW_MS' (never RealtimeConfig.*).
 */

import { Subject } from 'rxjs';
import { ModuleStateGrpcController } from './module-state.grpc.controller';
import {
  ActivityType,
  StateRequest,
  StateResponse,
} from '../../proto/generated/module_state';
import type { JwtPayload } from '../users/interfaces/auth.interface';

// ── Shared fixtures ──────────────────────────────────────────────────────────

function makeUser(overrides?: Partial<JwtPayload>): JwtPayload {
  return {
    sub: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    ...overrides,
  };
}

function makeActivityState(overrides?: Partial<{ sessionId: string; isPaused: boolean }>) {
  return { sessionId: 'session-1', isPaused: false, ...overrides } as any;
}

/**
 * Returns a mock ActivityEngine extended with not-yet-existing accessors
 * (listLiveSessions, getSoleChild) accessed via (engine as any) so the file
 * compiles before specs 05/06 add them.
 *
 * startActivity yields incrementing ids ('session-1', 'session-2', …) so that
 * "two distinct ids" is provable without relying on a constant return value.
 */
function makeActivityEngine() {
  let sessionCounter = 0;
  return {
    handleReconnect: jest.fn().mockResolvedValue(null),
    getActiveSession: jest.fn().mockReturnValue(undefined),
    handleTransportDisconnect: jest.fn().mockResolvedValue(undefined),
    startActivity: jest.fn().mockImplementation(() => {
      sessionCounter += 1;
      return Promise.resolve({ id: `session-${sessionCounter}` });
    }),
    endActivity: jest.fn().mockResolvedValue(null),
    stopActivity: jest.fn().mockResolvedValue(null),
    pauseActivity: jest.fn(),
    unpauseActivity: jest.fn(),
    // Not-yet-existing accessors (spec 06 / forward-coupling):
    // Accessed via (activityEngine as any).<method> throughout — do NOT use directly.
    listLiveSessions: jest.fn().mockReturnValue([]),
    getSoleChild: jest.fn().mockReturnValue(undefined),
  };
}

function makeRateLimiterService() {
  return {
    // Default: always allow — dedup tests are isolated from rate limiting
    consume: jest.fn().mockReturnValue(true),
    evict: jest.fn(),
  };
}

function makeActiveStreamRegistry() {
  return {
    register: jest.fn(),
    deregister: jest.fn(),
    closeAll: jest.fn(),
  };
}

/**
 * Key-aware configService mock.
 *
 * IMPORTANT: do NOT use a flat mockReturnValue(10) like the sibling spec does.
 * That returns 10 for every key, collapsing WS_IDEMPOTENCY_WINDOW_MS from
 * 10 000 ms to 10 ms and causing advanceTimersByTime calls to overshoot 1000×.
 */
function makeConfigService() {
  return {
    get: jest.fn((key: string, def?: unknown) => {
      // STRING LITERAL — do not import RealtimeConfig or reference the constant
      if (key === 'WS_IDEMPOTENCY_WINDOW_MS') return 10_000;
      return def ?? 10;
    }),
  };
}

function makeEventEmitter() {
  return { emit: jest.fn() };
}

/** Drains the microtask queue. Works under both real and fake timers. */
async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

// ── Request oneof builders ───────────────────────────────────────────────────

/**
 * Builds an activityStart oneof.
 *
 * Defaults to BREATH — leaving it at the default 0/ACTIVITY_TYPE_UNSPECIFIED
 * causes mapProtoActivityType to throw INVALID_ACTIVITY_TYPE and startActivity
 * is never called (wrong-reason failure).
 *
 * clientActivityId is a not-yet-existing proto field; set via (cmd as any).
 */
function activityStart(opts: {
  clientActivityId?: string;
  clientTimestampMs?: number;
  activityType?: ActivityType;
} = {}): StateRequest {
  const cmd: any = {
    activityType: opts.activityType ?? ActivityType.BREATH,
  };
  if (opts.clientActivityId !== undefined) {
    // Not-yet-existing proto field — accessed via (cmd as any) to compile before spec 05
    (cmd as any).clientActivityId = opts.clientActivityId;
  }
  if (opts.clientTimestampMs !== undefined) {
    cmd.clientTimestampMs = opts.clientTimestampMs;
  }
  return { activityStart: cmd };
}

function activityEnd(opts: { sessionId?: string; clientTimestampMs?: number } = {}): StateRequest {
  const cmd: any = {};
  if (opts.sessionId !== undefined) {
    // Not-yet-existing proto field
    (cmd as any).sessionId = opts.sessionId;
  }
  if (opts.clientTimestampMs !== undefined) {
    cmd.clientTimestampMs = opts.clientTimestampMs;
  }
  return { activityEnd: cmd };
}

function activityStop(opts: { sessionId?: string } = {}): StateRequest {
  const cmd: any = {};
  if (opts.sessionId !== undefined) {
    (cmd as any).sessionId = opts.sessionId;
  }
  return { activityStop: cmd };
}

function activityPause(opts: { sessionId?: string } = {}): StateRequest {
  const cmd: any = {};
  if (opts.sessionId !== undefined) {
    (cmd as any).sessionId = opts.sessionId;
  }
  return { activityPause: cmd };
}

function activityResume(opts: { sessionId?: string } = {}): StateRequest {
  const cmd: any = {};
  if (opts.sessionId !== undefined) {
    (cmd as any).sessionId = opts.sessionId;
  }
  return { activityResume: cmd };
}

// ── describe ─────────────────────────────────────────────────────────────────

describe('concurrent activities + idempotency dedup', () => {
  let controller: ModuleStateGrpcController;
  let activityEngine: ReturnType<typeof makeActivityEngine>;
  let rateLimiterService: ReturnType<typeof makeRateLimiterService>;
  let activeStreamRegistry: ReturnType<typeof makeActiveStreamRegistry>;
  let configService: ReturnType<typeof makeConfigService>;
  let eventEmitter: ReturnType<typeof makeEventEmitter>;

  beforeEach(() => {
    activityEngine = makeActivityEngine();
    rateLimiterService = makeRateLimiterService();
    activeStreamRegistry = makeActiveStreamRegistry();
    configService = makeConfigService();
    eventEmitter = makeEventEmitter();

    controller = new ModuleStateGrpcController(
      activityEngine as any,
      rateLimiterService as any,
      activeStreamRegistry as any,
      configService as any,
      eventEmitter as any,
    );
  });

  /**
   * Sets up a fully-connected stream (handleReconnect resolves with null,
   * request$ is subscribed to) and waits for setup() to complete.
   * Assert only on observable outputs — never on internal token/session maps.
   */
  async function setupStream(user = makeUser()) {
    const request$ = new Subject<StateRequest>();
    const values: StateResponse[] = [];

    const sub = controller.trackActivity(request$, user).subscribe({
      next: (v) => values.push(v),
      error: () => {},
      complete: () => {},
    });

    await flushMicrotasks();
    return { request$, values, sub };
  }

  // ── Phase 1: Concurrent-start ────────────────────────────────────────────
  //
  // Both cases are TARGET [RED until spec 06-state-controller-concurrent-idempotency].
  // They exercise removal of the singleton guard at module-state.grpc.controller.ts:281-290.
  // getActiveSession is wired to return an active session on the second start so the guard fires
  // and the test is genuinely RED today (echoes the existing id instead of creating a new child).

  describe('[TARGET — RED until spec 06] concurrent activity:start', () => {
    it('should create two distinct children for two activity:start with different clientActivityId', async () => {
      // First start: no existing session → startActivity runs.
      // Second start: getActiveSession returns the active session → guard echoes session-1 today.
      // After spec 06 (guard removed): both starts call startActivity → two distinct ids.
      activityEngine.getActiveSession
        .mockReturnValueOnce(undefined)
        .mockReturnValue(makeActivityState({ sessionId: 'session-1' }));

      const { request$, values } = await setupStream();

      request$.next(activityStart({ clientActivityId: 'activity-A' }));
      await flushMicrotasks();

      request$.next(activityStart({ clientActivityId: 'activity-B' }));
      await flushMicrotasks();

      // Spec 06 contract: two startActivity calls, two distinct moduleSessionIds.
      // TODAY: startActivity called once (guard echoes session-1 on second call) → RED.
      expect(activityEngine.startActivity).toHaveBeenCalledTimes(2);
      expect(values).toHaveLength(2);
      expect(values[0].sessionState?.moduleSessionId).not.toBe(
        values[1].sessionState?.moduleSessionId,
      );
    });

    it('should NOT return an existing session just because one is already active', async () => {
      // getActiveSession always reports a live session — the guard would echo it.
      // After spec 06 (guard removed): startActivity is called regardless.
      // Sentinel 'existing-session' is outside the counter space ('session-N') so it
      // cannot collide with startActivity's first output and the assertion is reachable.
      activityEngine.getActiveSession.mockReturnValue(
        makeActivityState({ sessionId: 'existing-session' }),
      );

      const { request$, values } = await setupStream();

      request$.next(activityStart({ clientActivityId: 'new-activity' }));
      await flushMicrotasks();

      // Spec 06 contract: startActivity is invoked and a new (non-echoed) id is returned.
      // TODAY: guard fires → startActivity NOT called, moduleSessionId echoed as 'existing-session' → RED.
      expect(activityEngine.startActivity).toHaveBeenCalledTimes(1);
      expect(values[0].sessionState?.moduleSessionId).not.toBe('existing-session');
    });
  });

  // ── Phase 2: Idempotency dedup ───────────────────────────────────────────
  //
  // Fake timers are scoped to this describe block only.
  // getActiveSession stays undefined here so the dedup map (not the removed guard) is
  // what's under test — makeActivityEngine() defaults getActiveSession to undefined.

  describe('idempotency dedup', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('[TARGET — RED until spec 06] should return the same moduleSessionId for a repeat clientActivityId within the window', async () => {
      const { request$, values } = await setupStream();

      // First start with token
      request$.next(activityStart({ clientActivityId: 'token-A' }));
      await flushMicrotasks();

      // Second start with same token — still within the 10 000 ms window
      request$.next(activityStart({ clientActivityId: 'token-A' }));
      await flushMicrotasks();

      // Spec 06 contract: dedup map returns cached id → startActivity called once.
      // TODAY: no dedup map → startActivity called twice → two different ids → RED.
      expect(activityEngine.startActivity).toHaveBeenCalledTimes(1);
      expect(values).toHaveLength(2);
      expect(values[0].sessionState?.moduleSessionId).toBe(
        values[1].sessionState?.moduleSessionId,
      );
    });

    it('[CHARACTERIZATION — GREEN now, must survive spec 06] should create a new session for a repeat clientActivityId after the window', async () => {
      const { request$, values } = await setupStream();

      // First start
      request$.next(activityStart({ clientActivityId: 'token-A' }));
      await flushMicrotasks();

      // Advance past the window (10 000 ms + 1 ms).
      // Advancing by exactly 10 000 would leave the token valid under > window expiry
      // (off-by-one), turning this RED for the wrong reason.
      jest.advanceTimersByTime(10_001);

      // Second start with same token — window has expired
      request$.next(activityStart({ clientActivityId: 'token-A' }));
      await flushMicrotasks();

      // Spec 06 contract (preserved): expired token → new startActivity call → different id.
      // TODAY: no dedup → always starts new → GREEN.
      expect(activityEngine.startActivity).toHaveBeenCalledTimes(2);
      expect(values).toHaveLength(2);
      expect(values[0].sessionState?.moduleSessionId).not.toBe(
        values[1].sessionState?.moduleSessionId,
      );
    });

    it('[CHARACTERIZATION — GREEN now, must survive spec 06] should scope the dedup token per user: same clientActivityId from a different user.sub yields a different session', async () => {
      const userOne = makeUser({ sub: 'user-1' });
      const userTwo = makeUser({ sub: 'user-2' });

      const { request$: req1, values: vals1 } = await setupStream(userOne);
      const { request$: req2, values: vals2 } = await setupStream(userTwo);

      req1.next(activityStart({ clientActivityId: 'shared-token' }));
      await flushMicrotasks();

      req2.next(activityStart({ clientActivityId: 'shared-token' }));
      await flushMicrotasks();

      // Spec 06 contract (preserved): dedup key is per-user → distinct bucket → startActivity
      // called for each user → different session ids.
      // TODAY: no dedup → startActivity called for each user anyway → GREEN.
      expect(activityEngine.startActivity).toHaveBeenCalledTimes(2);
      expect(vals1[0].sessionState?.moduleSessionId).not.toBe(
        vals2[0].sessionState?.moduleSessionId,
      );
    });

    it('[CHARACTERIZATION — GREEN now, must survive spec 06] should always create a new session when clientActivityId is absent (back-compat)', async () => {
      const { request$, values } = await setupStream();

      // No clientActivityId — back-compat: every call must hit startActivity
      request$.next(activityStart());
      await flushMicrotasks();

      request$.next(activityStart());
      await flushMicrotasks();

      // Spec 06 contract (preserved): no token → no dedup bucket → always creates.
      // TODAY: no dedup → always starts → GREEN.
      expect(activityEngine.startActivity).toHaveBeenCalledTimes(2);
      expect(values).toHaveLength(2);
      expect(values[0].sessionState?.moduleSessionId).not.toBe(
        values[1].sessionState?.moduleSessionId,
      );
    });

    it('[CHARACTERIZATION — GREEN now, must survive spec 06] should evict the token map on stream teardown so a repeat token on a new connection is not deduped', async () => {
      // First connection: push a start with a token
      const { request$: req1, values: vals1, sub: sub1 } = await setupStream();

      req1.next(activityStart({ clientActivityId: 'token-B' }));
      await flushMicrotasks();

      const firstSessionId = vals1[0]?.sessionState?.moduleSessionId;
      expect(firstSessionId).toBeDefined();

      // Tear down the first connection (simulates client disconnect / stream close)
      sub1.unsubscribe();

      // New connection — fresh stream
      const { request$: req2, values: vals2 } = await setupStream();

      req2.next(activityStart({ clientActivityId: 'token-B' }));
      await flushMicrotasks();

      // Spec 06 contract (preserved): teardown evicts the token map → fresh connection
      // starts a new session (startActivity called again, different id).
      // TODAY: no dedup → startActivity always called → GREEN.
      expect(activityEngine.startActivity).toHaveBeenCalledTimes(2);
      expect(vals2[0]?.sessionState?.moduleSessionId).not.toBe(firstSessionId);
    });
  });

  // ── Phase 3: session_id routing ──────────────────────────────────────────
  //
  // All three cases are TARGET [RED until spec 06-state-controller-concurrent-idempotency].
  // Today the handlers resolve by userId only — they ignore sessionId and have no
  // sole-child / ambiguity logic.

  describe('[TARGET — RED until spec 06] session_id routing', () => {
    it('should route pause/resume/end/stop to the child named by sessionId as the second positional argument', async () => {
      // Provide mock returns so the controller does not throw on null state
      activityEngine.pauseActivity.mockReturnValue(
        makeActivityState({ sessionId: 'session-A', isPaused: true }),
      );
      activityEngine.unpauseActivity.mockReturnValue(
        makeActivityState({ sessionId: 'session-A', isPaused: false }),
      );
      activityEngine.endActivity.mockResolvedValue({ id: 'session-A' });
      activityEngine.stopActivity.mockResolvedValue({ id: 'session-A' });

      const { request$ } = await setupStream();

      request$.next(activityPause({ sessionId: 'session-A' }));
      await flushMicrotasks();

      request$.next(activityResume({ sessionId: 'session-A' }));
      await flushMicrotasks();

      request$.next(activityEnd({ sessionId: 'session-A' }));
      await flushMicrotasks();

      request$.next(activityStop({ sessionId: 'session-A' }));
      await flushMicrotasks();

      // Spec 06 forward-coupling signatures:
      //   pauseActivity(userId, sessionId)
      //   unpauseActivity(userId, sessionId)
      //   endActivity(userId, sessionId, clientTimestampMs)
      //   stopActivity(userId, sessionId)
      // TODAY: handlers only pass userId → assertions fail → RED.
      expect(activityEngine.pauseActivity).toHaveBeenCalledWith('user-1', 'session-A');
      expect(activityEngine.unpauseActivity).toHaveBeenCalledWith('user-1', 'session-A');
      expect(activityEngine.endActivity).toHaveBeenCalledWith('user-1', 'session-A', undefined);
      expect(activityEngine.stopActivity).toHaveBeenCalledWith('user-1', 'session-A');
    });

    it('should fall back to the sole child when sessionId is absent and exactly one child exists', async () => {
      // getSoleChild returns the only live child
      (activityEngine as any).getSoleChild.mockReturnValue({
        sessionId: 'session-only',
        activityType: 'breath',
      });
      activityEngine.pauseActivity.mockReturnValue(
        makeActivityState({ sessionId: 'session-only', isPaused: true }),
      );

      const { request$ } = await setupStream();

      // No sessionId — sole-child resolver must kick in
      request$.next(activityPause());
      await flushMicrotasks();

      // Spec 06 contract: getSoleChild returns the child → pauseActivity called with its id.
      // TODAY: pauseActivity called with just userId (no sessionId) → RED.
      expect(activityEngine.pauseActivity).toHaveBeenCalledWith('user-1', 'session-only');
    });

    it('should emit sessionError.code === \'AMBIGUOUS_SESSION\' when sessionId is absent and >1 child is active', async () => {
      // Populate listLiveSessions with ≥2 children so spec 06 can detect ambiguity
      // via listLiveSessions().length > 1 — NOT just via getSoleChild returning undefined
      // (which conflates 0 children with >1 and would drive a buggy "no sole child ⇒ ambiguous" impl).
      (activityEngine as any).listLiveSessions.mockReturnValue([
        { sessionId: 'session-A', activityType: 'breath' },
        { sessionId: 'session-B', activityType: 'breath' },
      ]);
      (activityEngine as any).getSoleChild.mockReturnValue(undefined);
      // Return a valid state so if the controller incorrectly calls pauseActivity
      // it doesn't throw — we want to distinguish the wrong path, not mask with an INTERNAL_ERROR
      activityEngine.pauseActivity.mockReturnValue(
        makeActivityState({ sessionId: 'session-X', isPaused: true }),
      );

      const { request$, values } = await setupStream();

      request$.next(activityPause());
      await flushMicrotasks();

      // Spec 06 contract:
      //   - emit sessionError.code === 'AMBIGUOUS_SESSION' (literal string, not the constant)
      //   - do NOT call pauseActivity on any child
      // TODAY: controller calls pauseActivity(userId) without AMBIGUOUS_SESSION logic → RED.
      expect(
        values.some((v) => v.sessionError?.code === 'AMBIGUOUS_SESSION'),
      ).toBe(true);
      expect(activityEngine.pauseActivity).not.toHaveBeenCalled();
    });
  });

  // ── Phase 4: Revoke fan-out ──────────────────────────────────────────────
  //
  // TARGET [RED until spec 06-state-controller-concurrent-idempotency].
  // Today handleSessionRevoked issues a single stopActivity(userId).
  // After spec 06 it must enumerate listLiveSessions and issue a stopActivity(userId, sessionId)
  // for every live session (root + each child), then call closeAll.

  describe('[TARGET — RED until spec 06] handleSessionRevoked fan-out', () => {
    it('should call stopActivity(userId, sessionId) for every live session and closeAll once', async () => {
      const liveSessions = [
        { sessionId: 'session-root', activityType: 'root' },
        { sessionId: 'session-A', activityType: 'breath' },
        { sessionId: 'session-B', activityType: 'breath' },
      ];
      // Not-yet-existing method — accessed via (activityEngine as any)
      (activityEngine as any).listLiveSessions.mockReturnValue(liveSessions);

      await controller.handleSessionRevoked({ userId: 'user-1' });

      // Spec 06 contract: one stopActivity call per live session with (userId, sessionId).
      // TODAY: stopActivity called once with just (userId) → toHaveBeenCalledTimes(3) fails → RED.
      expect(activityEngine.stopActivity).toHaveBeenCalledTimes(3);
      expect(activityEngine.stopActivity).toHaveBeenCalledWith('user-1', 'session-root');
      expect(activityEngine.stopActivity).toHaveBeenCalledWith('user-1', 'session-A');
      expect(activityEngine.stopActivity).toHaveBeenCalledWith('user-1', 'session-B');

      // closeAll is called once regardless of session count
      expect(activeStreamRegistry.closeAll).toHaveBeenCalledWith('user-1');
      expect(activeStreamRegistry.closeAll).toHaveBeenCalledTimes(1);
    });
  });
});
