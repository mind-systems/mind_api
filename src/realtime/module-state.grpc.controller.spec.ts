import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Subject, Subscriber } from 'rxjs';
import { ModuleStateGrpcController } from './module-state.grpc.controller';
import {
  ActivityStatus,
  ActivityType,
  StateRequest,
  StateResponse,
} from '../../proto/generated/module_state';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { StreamService } from './constants/stream-service';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeUser(overrides?: Partial<JwtPayload>): JwtPayload {
  return {
    sub: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    ...overrides,
  };
}

function makeSession(overrides?: Partial<{ id: string }>) {
  return { id: 'session-1', ...overrides } as any;
}

function makeActivityEngine() {
  return {
    handleReconnect: jest.fn().mockResolvedValue(null),
    ensureRoot: jest.fn().mockResolvedValue(makeSession()),
    getActiveSession: jest.fn().mockReturnValue(undefined),
    // getSession: load-bearing for spec 24 — note 24 reads isPaused via
    // this.activityEngine.getSession(userId, result.id)?.isPaused ?? false
    // in the reconnect emission block. Default undefined → ?? false keeps all
    // pre-note-24 cases green.
    getSession: jest.fn().mockReturnValue(undefined),
    handleTransportDisconnect: jest.fn().mockResolvedValue(undefined),
    supersedeChildren: jest.fn().mockResolvedValue(undefined),
    startActivity: jest.fn().mockResolvedValue(makeSession()),
    endActivity: jest.fn().mockResolvedValue(null),
    stopActivity: jest.fn().mockResolvedValue(null),
    pauseActivity: jest.fn(),
    unpauseActivity: jest.fn(),
    getSoleChild: jest.fn().mockReturnValue(undefined),
    getRootId: jest.fn(),
    listLiveSessions: jest
      .fn()
      .mockReturnValue([{ sessionId: 'session-1', activityType: 'breath' }]),
    listChildren: jest.fn().mockReturnValue([]),
  };
}

function makeRateLimiterService() {
  return {
    consume: jest.fn().mockReturnValue(true),
    evict: jest.fn(),
  };
}

function makeActiveStreamRegistry() {
  return {
    register: jest.fn(),
    deregister: jest.fn().mockReturnValue(false),
    closeAll: jest.fn(),
  };
}

function makeConfigService() {
  return {
    get: jest.fn().mockReturnValue(10),
  };
}

function makeEventEmitter() {
  return {
    emit: jest.fn(),
  };
}

/** Drains the microtask queue enough for async setup() to complete. */
async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

// ── describe ─────────────────────────────────────────────────────────────────

describe('ModuleStateGrpcController', () => {
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

  // ── Task 2: Authentication ────────────────────────────────────────────────

  describe('trackActivity — authentication', () => {
    it('should error with UNAUTHENTICATED RpcException when user argument is null', (done) => {
      const request$ = new Subject<StateRequest>();
      controller.trackActivity(request$, null).subscribe({
        error: (err: unknown) => {
          expect(err).toBeInstanceOf(RpcException);
          expect((err as RpcException).getError()).toMatchObject({
            code: GrpcStatus.UNAUTHENTICATED,
          });
          done();
        },
      });
    });

    it('should not call activeStreamRegistry.register when user is null', () => {
      const request$ = new Subject<StateRequest>();
      controller.trackActivity(request$, null).subscribe({ error: () => {} });
      expect(activeStreamRegistry.register).not.toHaveBeenCalled();
    });

    it('should not invoke activityEngine.handleReconnect when user is null', () => {
      const request$ = new Subject<StateRequest>();
      controller.trackActivity(request$, null).subscribe({ error: () => {} });
      expect(activityEngine.handleReconnect).not.toHaveBeenCalled();
    });

    it('should call activeStreamRegistry.register(user.sub, subscriber) when user is present', () => {
      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const sub = controller
        .trackActivity(request$, user)
        .subscribe({ error: () => {} });
      expect(activeStreamRegistry.register).toHaveBeenCalledWith(
        user.sub,
        StreamService.STATE,
        expect.any(Subscriber),
        expect.any(Function),
      );
      sub.unsubscribe();
    });
  });

  // ── Task 3: Reconnect path ────────────────────────────────────────────────

  describe('trackActivity — reconnect path', () => {
    function makeLiveChild(
      overrides?: Partial<{
        sessionId: string;
        activityType: string;
        isPaused: boolean;
      }>,
    ) {
      return {
        sessionId: 'child-1',
        activityType: 'breath',
        isPaused: false,
        ...overrides,
      };
    }

    // (a) RESUMED path — unpaused branch (getSession returns undefined → ?? false)
    // Characterization: must stay GREEN now and after spec 24-pause-state-integrity.
    it('(a) should emit sessionState RESUMED with isPaused false when handleReconnect returns a session and getSession returns undefined', async () => {
      activityEngine.handleReconnect.mockResolvedValue(
        makeSession({ id: 'resumed-session' }),
      );
      // getSession defaults to undefined → isPaused ?? false = false (unpaused branch)

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();

      // Expect [RESUMED] only — no root frame on reconnect
      expect(values).toHaveLength(1);
      expect(values[0].sessionState).toMatchObject({
        status: ActivityStatus.RESUMED,
        isPaused: false,
      });

      sub.unsubscribe();
    });

    // (b) RESUMED path — paused branch — RED until spec 24-pause-state-integrity
    // Controller currently hardcodes isPaused: false in the reconnect emission block.
    // After spec 24 lands it reads this.activityEngine.getSession(userId, result.id)?.isPaused ?? false.
    // Do NOT weaken or skip after spec 24 — escalate if still RED.
    it('(b) RED until spec 24-pause-state-integrity — should emit sessionState RESUMED with isPaused true when getSession returns a paused session', async () => {
      activityEngine.handleReconnect.mockResolvedValue(
        makeSession({ id: 'resumed-session' }),
      );
      activityEngine.getSession.mockReturnValue({ isPaused: true } as any);

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();

      // RED now: controller hardcodes isPaused: false → actual emitted value is false
      // GREEN after spec 24: controller reads getSession()?.isPaused ?? false → true
      expect(values).toHaveLength(1);
      expect(values[0].sessionState).toMatchObject({
        status: ActivityStatus.RESUMED,
        isPaused: true,
      });

      sub.unsubscribe();
    });

    it('should include the resumed session id as moduleSessionId in the emitted StateResponse', async () => {
      activityEngine.handleReconnect.mockResolvedValue(
        makeSession({ id: 'my-session-id' }),
      );

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();

      expect(values[0]?.sessionState?.moduleSessionId).toBe('my-session-id');

      sub.unsubscribe();
    });

    it('should not emit any frame on a fresh connect', async () => {
      activityEngine.handleReconnect.mockResolvedValue(null);

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();

      expect(values).toHaveLength(0);

      sub.unsubscribe();
    });

    it('should subscribe to the request observable after handleReconnect resolves', async () => {
      activityEngine.handleReconnect.mockResolvedValue(null);

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const subscribeSpy = jest.spyOn(request$, 'subscribe');
      const sub = controller
        .trackActivity(request$, user)
        .subscribe({ error: () => {} });

      // setup() has not yet resumed — request$ must not be subscribed to yet
      expect(subscribeSpy).not.toHaveBeenCalled();

      await flushMicrotasks();

      // after handleReconnect resolves, request$ is subscribed to
      expect(subscribeSpy).toHaveBeenCalledTimes(1);

      sub.unsubscribe();
    });

    it('should not emit RESUMED when subscriber.closed is already true by the time handleReconnect resolves', async () => {
      // Capture the subscriber via register so we can close it before reconnect resolves
      let capturedSubscriber: Subscriber<StateResponse> | undefined;
      activeStreamRegistry.register = jest.fn(
        (_userId, sub: Subscriber<StateResponse>) => {
          capturedSubscriber = sub;
        },
      );

      // Make handleReconnect a deferred promise so we control when setup() resumes
      let resolveReconnect!: (val: any) => void;
      activityEngine.handleReconnect = jest.fn(
        () =>
          new Promise<any>((resolve) => {
            resolveReconnect = resolve;
          }),
      );

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
        complete: () => {},
      });

      // Close the subscriber BEFORE reconnect resolves — simulates the client hanging up mid-setup
      capturedSubscriber!.complete();

      // Now resolve reconnect with a session
      resolveReconnect(makeSession());
      await flushMicrotasks();

      expect(values).toHaveLength(0);
    });

    // (b) Abandoned path — emits [ABANDONED]
    it('(b) should emit sessionState ABANDONED when handleReconnect returns { abandoned: true }', async () => {
      activityEngine.handleReconnect.mockResolvedValue({ abandoned: true });

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller
        .trackActivity(request$, user, 'client-session-id')
        .subscribe({
          next: (v) => values.push(v),
          error: () => {},
        });

      await flushMicrotasks();

      // Expect [ABANDONED] only — no root frame on reconnect
      expect(values).toHaveLength(1);
      expect(values[0].sessionState).toMatchObject({
        status: ActivityStatus.ABANDONED,
        moduleSessionId: 'client-session-id',
      });

      sub.unsubscribe();
    });

    // (c) Fresh connect with no clientSessionId → emits no frame
    it('(c) should not emit any frame on connect when handleReconnect returns null and no clientSessionId is provided', async () => {
      activityEngine.handleReconnect.mockResolvedValue(null);

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();

      expect(values).toHaveLength(0);

      sub.unsubscribe();
    });

    // (d) Stream stays open after abandoned emit — subsequent activity:start produces ACTIVE
    it('(d) stream stays open after abandoned emit — subsequent activityStart routes to ACTIVE', async () => {
      activityEngine.handleReconnect.mockResolvedValue({ abandoned: true });
      const startedSession = makeSession({ id: 'new-session' });
      activityEngine.startActivity.mockResolvedValue(startedSession);

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller
        .trackActivity(request$, user, 'client-session-id')
        .subscribe({
          next: (v) => values.push(v),
          error: () => {},
          complete: () => {},
        });

      await flushMicrotasks();

      // After connect: [ABANDONED]
      expect(values).toHaveLength(1);
      expect(values[0].sessionState?.status).toBe(ActivityStatus.ABANDONED);

      // Stream must still be open (complete() was not called)
      expect(sub.closed).toBe(false);

      // Send activityStart — should produce ACTIVE at values[1]
      request$.next({ activityStart: { activityType: ActivityType.BREATH } });
      await flushMicrotasks();

      expect(values).toHaveLength(2);
      expect(values[1].sessionState?.status).toBe(ActivityStatus.ACTIVE);
      expect(values[1].sessionState?.moduleSessionId).toBe('new-session');

      sub.unsubscribe();
    });

    // ── per-child RESUMED frames on reconnect (RED until spec 45) ────────────

    it('two live children → two RESUMED frames', async () => {
      activityEngine.handleReconnect.mockResolvedValue(makeSession());
      activityEngine.listChildren.mockReturnValue([
        makeLiveChild({ sessionId: 'child-1', activityType: 'breath' }),
        makeLiveChild({
          sessionId: 'child-2',
          activityType: 'meditation',
          isPaused: true,
        }),
      ]);

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();

      expect(values).toHaveLength(2);
      expect(values[0].sessionState).toMatchObject({
        moduleSessionId: 'child-1',
        status: ActivityStatus.RESUMED,
        isPaused: false,
        activityType: ActivityType.BREATH,
      });
      expect(values[1].sessionState).toMatchObject({
        moduleSessionId: 'child-2',
        status: ActivityStatus.RESUMED,
        isPaused: true,
        activityType: ActivityType.MEDITATION,
      });

      sub.unsubscribe();
    });

    it('single live child → exactly one RESUMED frame via the new path', async () => {
      activityEngine.handleReconnect.mockResolvedValue(makeSession());
      activityEngine.listChildren.mockReturnValue([
        makeLiveChild({ sessionId: 'child-1' }),
      ]);

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();

      expect(values).toHaveLength(1);
      expect(values[0].sessionState?.moduleSessionId).toBe('child-1');

      sub.unsubscribe();
    });

    // (optional reinforcement) ABANDONED unaffected by children present
    it('ABANDONED unaffected by children present', async () => {
      activityEngine.handleReconnect.mockResolvedValue({
        abandoned: true,
      } as any);
      activityEngine.listChildren.mockReturnValue([makeLiveChild()]);

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller
        .trackActivity(request$, user, 'client-session-id')
        .subscribe({
          next: (v) => values.push(v),
          error: () => {},
        });

      await flushMicrotasks();

      expect(values).toHaveLength(1);
      expect(values[0].sessionState).toMatchObject({
        status: ActivityStatus.ABANDONED,
        moduleSessionId: 'client-session-id',
      });
      expect(activityEngine.listChildren).not.toHaveBeenCalled();

      sub.unsubscribe();
    });
  });

  // ── Client-started root (RED until a1) ───────────────────────────────────

  describe('trackActivity — client-started root', () => {
    // a1 adds ActivityType.ROOT = 3; use a numeric cast until proto stub is regenerated
    const ROOT_ACTIVITY_TYPE = 3 as ActivityType;

    it('should emit an ACTIVE sessionState frame with activityType === ROOT (3) when activity:start ROOT is received', async () => {
      activityEngine.ensureRoot.mockResolvedValue(
        makeSession({ id: 'root-1' }),
      );

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();

      request$.next({ activityStart: { activityType: ROOT_ACTIVITY_TYPE } });
      await flushMicrotasks();

      // RED today: mapProtoActivityType throws on ROOT → sessionError INVALID_ACTIVITY_TYPE
      // GREEN after a1: one sessionState with moduleSessionId 'root-1', status ACTIVE, activityType 3
      expect(values).toHaveLength(1);
      expect(values[0].sessionState?.moduleSessionId).toBe('root-1');
      expect(values[0].sessionState?.status).toBe(ActivityStatus.ACTIVE);
      // ts-proto camelCases activity_type → activityType; cast as any until stub is regenerated
      expect((values[0].sessionState as any).activityType).toBe(3);

      sub.unsubscribe();
    });

    it('should route activity:start ROOT through ensureRoot, not startActivity', async () => {
      activityEngine.ensureRoot.mockResolvedValue(
        makeSession({ id: 'root-1' }),
      );

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const sub = controller.trackActivity(request$, user).subscribe({
        error: () => {},
      });

      await flushMicrotasks();
      // Clear the connect-time ensureRoot call so only the command's call is observed
      activityEngine.ensureRoot.mockClear();

      request$.next({ activityStart: { activityType: ROOT_ACTIVITY_TYPE } });
      await flushMicrotasks();

      // RED today: ROOT throws in mapProtoActivityType before any per-command ensureRoot call
      // GREEN after a1: ROOT routes to ensureRoot
      expect(activityEngine.ensureRoot).toHaveBeenCalled();
      expect(activityEngine.startActivity).not.toHaveBeenCalled();

      sub.unsubscribe();
    });

    it('should be idempotent — two activity:start ROOT commands both emit sessionState with moduleSessionId root-1', async () => {
      activityEngine.ensureRoot.mockResolvedValue(
        makeSession({ id: 'root-1' }),
      );

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();

      request$.next({ activityStart: { activityType: ROOT_ACTIVITY_TYPE } });
      await flushMicrotasks();

      request$.next({ activityStart: { activityType: ROOT_ACTIVITY_TYPE } });
      await flushMicrotasks();

      // RED today: both commands emit sessionError (moduleSessionId undefined)
      // GREEN after a1: both frames are sessionState with moduleSessionId 'root-1'
      expect(values).toHaveLength(2);
      expect(values[0]?.sessionState?.moduleSessionId).toBe('root-1');
      expect(values[1]?.sessionState?.moduleSessionId).toBe('root-1');

      sub.unsubscribe();
    });

    it('should emit a sessionState frame with activityType !== ROOT (3) for a child BREATH activity', async () => {
      activityEngine.startActivity.mockResolvedValue(
        makeSession({ id: 'child-1' }),
      );

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();

      request$.next({ activityStart: { activityType: ActivityType.BREATH } });
      await flushMicrotasks();

      // The child frame must not be flagged as ROOT — negative discriminator guard
      expect((values[0]?.sessionState as any)?.activityType).not.toBe(3);

      sub.unsubscribe();
    });

    it('should emit sessionError CANNOT_END_ROOT and not call endActivity when activityEnd targets the root session', async () => {
      activityEngine.getRootId.mockReturnValue('root-1');

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();
      // Drain connect-phase frames (none on fresh connect, but guard future changes)
      values.length = 0;

      request$.next({ activityEnd: { sessionId: 'root-1' } });
      await flushMicrotasks();

      // RED today: no guard exists — endActivity is called (returns null → no frame, len 0); both
      //   toHaveLength(1) and not.toHaveBeenCalled() fail
      // GREEN after a1: sessionError CANNOT_END_ROOT emitted, endActivity not called
      expect(values).toHaveLength(1);
      expect(values[0]?.sessionError?.code).toBe('CANNOT_END_ROOT');
      expect(activityEngine.endActivity).not.toHaveBeenCalled();
      expect(values[0]?.sessionState?.status).not.toBe(
        ActivityStatus.COMPLETED,
      );

      sub.unsubscribe();
    });

    it('should emit sessionError CANNOT_END_ROOT and not call stopActivity when activityStop targets the root session', async () => {
      activityEngine.getRootId.mockReturnValue('root-1');

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();
      // Drain connect-phase frames (none on fresh connect, but guard future changes)
      values.length = 0;

      request$.next({ activityStop: { sessionId: 'root-1' } });
      await flushMicrotasks();

      // RED today: no guard exists — stopActivity is called (returns null → no frame, len 0); both
      //   toHaveLength(1) and not.toHaveBeenCalled() fail
      // GREEN after a1: sessionError CANNOT_END_ROOT emitted, stopActivity not called
      expect(values).toHaveLength(1);
      expect(values[0]?.sessionError?.code).toBe('CANNOT_END_ROOT');
      expect(activityEngine.stopActivity).not.toHaveBeenCalled();
      expect(values[0]?.sessionState?.status).not.toBe(
        ActivityStatus.INTERRUPTED,
      );

      sub.unsubscribe();
    });
  });

  // ── Task 4: Setup error ───────────────────────────────────────────────────

  describe('trackActivity — setup error', () => {
    it('should emit StateResponse.sessionError with code INTERNAL_ERROR when handleReconnect rejects', async () => {
      activityEngine.handleReconnect.mockRejectedValue(new Error('DB error'));

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
        complete: () => {},
      });

      await flushMicrotasks();

      expect(values).toHaveLength(1);
      expect(values[0].sessionError?.code).toBe('INTERNAL_ERROR');
    });

    it('should call subscriber.complete after emitting INTERNAL_ERROR on setup failure', async () => {
      activityEngine.handleReconnect.mockRejectedValue(new Error('DB error'));

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      let completed = false;
      controller.trackActivity(request$, user).subscribe({
        error: () => {},
        complete: () => {
          completed = true;
        },
      });

      await flushMicrotasks();

      expect(completed).toBe(true);
    });

    it('should not subscribe to the request observable when setup fails', async () => {
      activityEngine.handleReconnect.mockRejectedValue(new Error('DB error'));

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const subscribeSpy = jest.spyOn(request$, 'subscribe');
      controller.trackActivity(request$, user).subscribe({
        next: () => {},
        error: () => {},
        complete: () => {},
      });

      await flushMicrotasks();

      expect(subscribeSpy).not.toHaveBeenCalled();
    });

    it('should still register the subscriber with activeStreamRegistry before setup runs', () => {
      activityEngine.handleReconnect.mockRejectedValue(new Error('DB error'));

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      controller.trackActivity(request$, user).subscribe({
        next: () => {},
        error: () => {},
        complete: () => {},
      });

      // register is called synchronously in the subscriber function — before setup() even starts
      expect(activeStreamRegistry.register).toHaveBeenCalledWith(
        user.sub,
        StreamService.STATE,
        expect.any(Subscriber),
        expect.any(Function),
      );
    });
  });

  // ── Task 5: Stream teardown ───────────────────────────────────────────────

  describe('trackActivity — stream teardown', () => {
    /**
     * Sets up a fully-connected stream (handleReconnect resolves with null,
     * request$ is subscribed to) and waits for setup() to complete.
     */
    async function setupConnectedStream(user = makeUser()) {
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];

      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
        complete: () => {},
      });

      await flushMicrotasks();
      return { sub, request$, user, values };
    }

    it('should call activeStreamRegistry.deregister(userId, subscriber) when the consumer unsubscribes', async () => {
      const user = makeUser();
      const { sub } = await setupConnectedStream(user);

      sub.unsubscribe();

      expect(activeStreamRegistry.deregister).toHaveBeenCalledWith(
        user.sub,
        StreamService.STATE,
        expect.any(Subscriber),
      );
    });

    it('should call activityEngine.handleTransportDisconnect(userId) on teardown', async () => {
      const user = makeUser();
      const { sub } = await setupConnectedStream(user);

      sub.unsubscribe();

      expect(activityEngine.handleTransportDisconnect).toHaveBeenCalledWith(
        user.sub,
      );
      // Genuine drop (deregister returns false by default) must never route
      // through the eviction/takeover branch.
      expect(activityEngine.supersedeChildren).not.toHaveBeenCalled();
    });

    it("should call rateLimiterService.evict('activity-start:{userId}') on teardown", async () => {
      const user = makeUser();
      const { sub } = await setupConnectedStream(user);

      sub.unsubscribe();

      expect(rateLimiterService.evict).toHaveBeenCalledWith(
        `activity-start:${user.sub}`,
      );
    });

    it('should invoke teardown actions in order: deregister → handleTransportDisconnect → evict', async () => {
      const callOrder: string[] = [];
      activeStreamRegistry.deregister = jest.fn(() => {
        callOrder.push('deregister');
      });
      activityEngine.handleTransportDisconnect = jest.fn(() => {
        callOrder.push('handleTransportDisconnect');
        return Promise.resolve();
      });
      rateLimiterService.evict = jest.fn(() => {
        callOrder.push('evict');
      });

      const user = makeUser();
      const { sub } = await setupConnectedStream(user);

      sub.unsubscribe();

      // handleTransportDisconnect is inside an async IIFE — its invocation is still
      // synchronous (it starts the async work) so the order is deterministic.
      expect(callOrder).toEqual([
        'deregister',
        'handleTransportDisconnect',
        'evict',
      ]);
    });

    it('should swallow errors thrown by handleTransportDisconnect and not propagate them to the caller', async () => {
      activityEngine.handleTransportDisconnect.mockRejectedValue(
        new Error('network fail'),
      );

      const user = makeUser();
      const { sub } = await setupConnectedStream(user);

      expect(() => sub.unsubscribe()).not.toThrow();

      // Allow the rejected promise to settle without crashing the test
      await flushMicrotasks();
    });

    it('should still call rateLimiterService.evict when handleTransportDisconnect rejects', async () => {
      activityEngine.handleTransportDisconnect.mockRejectedValue(
        new Error('network fail'),
      );

      const user = makeUser();
      const { sub } = await setupConnectedStream(user);

      sub.unsubscribe();

      // evict is synchronous and runs right after starting the async IIFE
      expect(rateLimiterService.evict).toHaveBeenCalledWith(
        `activity-start:${user.sub}`,
      );

      await flushMicrotasks();
    });

    it('should run teardown when the request observable completes', async () => {
      const user = makeUser();
      const { request$ } = await setupConnectedStream(user);

      request$.complete();

      expect(activeStreamRegistry.deregister).toHaveBeenCalledWith(
        user.sub,
        StreamService.STATE,
        expect.any(Subscriber),
      );
    });

    it('should run teardown when the request observable errors', async () => {
      const user = makeUser();
      const { request$ } = await setupConnectedStream(user);

      request$.error(new Error('stream error'));
      await flushMicrotasks();

      expect(activeStreamRegistry.deregister).toHaveBeenCalledWith(
        user.sub,
        StreamService.STATE,
        expect.any(Subscriber),
      );
    });

    it('should call activityEngine.supersedeChildren (not handleTransportDisconnect) when the teardown was caused by eviction (registry.deregister returns true)', async () => {
      activeStreamRegistry.deregister.mockReturnValue(true); // simulates: this subscriber was evicted by a newer connect
      const user = makeUser();
      const { sub } = await setupConnectedStream(user);

      sub.unsubscribe();

      expect(activityEngine.supersedeChildren).toHaveBeenCalledWith(user.sub);
      expect(activityEngine.handleTransportDisconnect).not.toHaveBeenCalled();
    });

    it('should register the STATE stream with an onEvict callback that pushes a CONNECTION_SUPERSEDED session_error on the evicted subscriber', () => {
      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const sub = controller
        .trackActivity(request$, user)
        .subscribe({ error: () => {} });

      expect(activeStreamRegistry.register).toHaveBeenCalledWith(
        user.sub,
        StreamService.STATE,
        expect.any(Subscriber),
        expect.any(Function),
      );

      // Simulate what the real registry does on eviction: invoke the captured callback
      // against a fake "evicted" subscriber and assert the frame it pushes.
      const onEvict = activeStreamRegistry.register.mock.calls[0][3];
      const evictedNext = jest.fn();
      onEvict({ next: evictedNext } as any);
      expect(evictedNext).toHaveBeenCalledWith({
        sessionError: expect.objectContaining({
          code: 'CONNECTION_SUPERSEDED',
        }),
      });

      sub.unsubscribe();
    });
  });

  // ── Task 6: handleSessionRevoked ─────────────────────────────────────────

  describe('handleSessionRevoked', () => {
    it('should call activityEngine.stopActivity(payload.userId)', async () => {
      await controller.handleSessionRevoked({ userId: 'user-1' });
      expect(activityEngine.stopActivity).toHaveBeenCalledWith(
        'user-1',
        'session-1',
      );
    });

    it('should call activeStreamRegistry.closeAll(payload.userId)', async () => {
      await controller.handleSessionRevoked({ userId: 'user-1' });
      expect(activeStreamRegistry.closeAll).toHaveBeenCalledWith('user-1');
    });

    it('should call closeAll even when stopActivity throws', async () => {
      activityEngine.stopActivity.mockRejectedValue(new Error('stop failed'));
      await controller.handleSessionRevoked({ userId: 'user-1' });
      expect(activeStreamRegistry.closeAll).toHaveBeenCalledWith('user-1');
    });

    it('should not rethrow when stopActivity rejects', async () => {
      activityEngine.stopActivity.mockRejectedValue(new Error('stop failed'));
      await expect(
        controller.handleSessionRevoked({ userId: 'user-1' }),
      ).resolves.toBeUndefined();
    });

    it('should call stopActivity before closeAll', async () => {
      const callOrder: string[] = [];
      activityEngine.stopActivity = jest.fn(async () => {
        callOrder.push('stopActivity');
        return null;
      });
      activeStreamRegistry.closeAll = jest.fn(() => {
        callOrder.push('closeAll');
      });

      await controller.handleSessionRevoked({ userId: 'user-1' });

      expect(callOrder).toEqual(['stopActivity', 'closeAll']);
    });
  });

  // ── Command routing ───────────────────────────────────────────────────────

  describe('trackActivity — command routing', () => {
    function makeActivityState(
      overrides?: Partial<{ sessionId: string; isPaused: boolean }>,
    ) {
      return { sessionId: 'session-1', isPaused: false, ...overrides } as any;
    }

    async function setupRoutingStream(user = makeUser()) {
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];

      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
        complete: () => {},
      });

      await flushMicrotasks();
      // Drain any connect-phase frames so command-routing tests start with an empty
      // values array and index assertions remain stable. On the default
      // handleReconnect → null path no frames are emitted, so this is a no-op.
      values.length = 0;
      return { sub, request$, values };
    }

    // ── Task 1: ActivityStart ───────────────────────────────────────────────

    describe('trackActivity — command routing → ActivityStart', () => {
      it('should emit sessionError RATE_LIMIT_EXCEEDED when rateLimiterService.consume returns false', async () => {
        rateLimiterService.consume.mockReturnValueOnce(false);
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityStart: { activityType: ActivityType.BREATH } });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('RATE_LIMIT_EXCEEDED');
      });

      it('should not call activityEngine.startActivity when rate limit is exceeded', async () => {
        rateLimiterService.consume.mockReturnValueOnce(false);
        const { request$ } = await setupRoutingStream();

        request$.next({ activityStart: { activityType: ActivityType.BREATH } });
        await flushMicrotasks();

        expect(activityEngine.startActivity).not.toHaveBeenCalled();
      });

      it('should emit sessionError INVALID_ACTIVITY_TYPE when cmd.activityType is unsupported (e.g. ACTIVITY_TYPE_UNSPECIFIED)', async () => {
        const { request$, values } = await setupRoutingStream();

        request$.next({
          activityStart: {
            activityType: ActivityType.ACTIVITY_TYPE_UNSPECIFIED,
          },
        });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('INVALID_ACTIVITY_TYPE');
      });

      it('should not call activityEngine.startActivity when activityType is unsupported', async () => {
        const { request$ } = await setupRoutingStream();

        request$.next({
          activityStart: {
            activityType: ActivityType.ACTIVITY_TYPE_UNSPECIFIED,
          },
        });
        await flushMicrotasks();

        expect(activityEngine.startActivity).not.toHaveBeenCalled();
      });

      it('should call activityEngine.startActivity(userId, { activityType: BREATH, activityRefId: cmd.refId }) on the happy path', async () => {
        const { request$ } = await setupRoutingStream();

        request$.next({
          activityStart: {
            activityType: ActivityType.BREATH,
            refId: 'ref-123',
          },
        });
        await flushMicrotasks();

        expect(activityEngine.startActivity).toHaveBeenCalledWith('user-1', {
          activityType: 'breath',
          activityRefId: 'ref-123',
        });
      });

      it('should emit sessionState ACTIVE with moduleSessionId from the returned session on the happy path', async () => {
        activityEngine.startActivity.mockResolvedValue(
          makeSession({ id: 'new-session' }),
        );
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityStart: { activityType: ActivityType.BREATH } });
        await flushMicrotasks();

        expect(values[0]?.sessionState?.status).toBe(ActivityStatus.ACTIVE);
        expect(values[0]?.sessionState?.moduleSessionId).toBe('new-session');
      });

      it('should forward cmd.refId to the engine as activityRefId (string value preserved)', async () => {
        const { request$ } = await setupRoutingStream();

        request$.next({
          activityStart: {
            activityType: ActivityType.BREATH,
            refId: 'my-ref-id',
          },
        });
        await flushMicrotasks();

        expect(activityEngine.startActivity).toHaveBeenCalledWith(
          'user-1',
          expect.objectContaining({ activityRefId: 'my-ref-id' }),
        );
      });

      it('should omit the isPaused field from the emitted sessionState on the happy path', async () => {
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityStart: { activityType: ActivityType.BREATH } });
        await flushMicrotasks();

        expect(values[0]?.sessionState).toBeDefined();
        expect('isPaused' in values[0].sessionState!).toBe(false);
      });
    });

    // ── Task 2: ActivityEnd ─────────────────────────────────────────────────

    describe('trackActivity — command routing → ActivityEnd', () => {
      it('should call activityEngine.endActivity(userId) when ActivityEnd is received', async () => {
        const { request$ } = await setupRoutingStream();

        request$.next({ activityEnd: {} });
        await flushMicrotasks();

        expect(activityEngine.endActivity).toHaveBeenCalledWith(
          'user-1',
          undefined,
          undefined,
        );
      });

      it('should emit sessionState COMPLETED with moduleSessionId from the returned session', async () => {
        activityEngine.endActivity.mockResolvedValue(
          makeSession({ id: 'ended-session' }),
        );
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityEnd: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionState?.status).toBe(ActivityStatus.COMPLETED);
        expect(values[0]?.sessionState?.moduleSessionId).toBe('ended-session');
      });

      it('should not emit any StateResponse when endActivity resolves to null', async () => {
        activityEngine.endActivity.mockResolvedValue(null);
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityEnd: {} });
        await flushMicrotasks();

        expect(values).toHaveLength(0);
      });

      it('should omit the isPaused field from the emitted sessionState on COMPLETED', async () => {
        activityEngine.endActivity.mockResolvedValue(
          makeSession({ id: 'ended-session' }),
        );
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityEnd: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionState).toBeDefined();
        expect('isPaused' in values[0].sessionState!).toBe(false);
      });
    });

    // ── Task 3: ActivityStop ────────────────────────────────────────────────

    describe('trackActivity — command routing → ActivityStop', () => {
      it('should call activityEngine.stopActivity(userId) when ActivityStop is received', async () => {
        const { request$ } = await setupRoutingStream();

        request$.next({ activityStop: {} });
        await flushMicrotasks();

        expect(activityEngine.stopActivity).toHaveBeenCalledWith(
          'user-1',
          undefined,
        );
      });

      it('should emit sessionState INTERRUPTED with moduleSessionId from the returned session', async () => {
        activityEngine.stopActivity.mockResolvedValue(
          makeSession({ id: 'stopped-session' }),
        );
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityStop: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionState?.status).toBe(
          ActivityStatus.INTERRUPTED,
        );
        expect(values[0]?.sessionState?.moduleSessionId).toBe(
          'stopped-session',
        );
      });

      it('should not emit any StateResponse when stopActivity resolves to null', async () => {
        activityEngine.stopActivity.mockResolvedValue(null);
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityStop: {} });
        await flushMicrotasks();

        expect(values).toHaveLength(0);
      });

      it('should omit the isPaused field from the emitted sessionState on INTERRUPTED', async () => {
        activityEngine.stopActivity.mockResolvedValue(
          makeSession({ id: 'stopped-session' }),
        );
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityStop: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionState).toBeDefined();
        expect('isPaused' in values[0].sessionState!).toBe(false);
      });
    });

    // ── Task 4: ActivityPause ───────────────────────────────────────────────

    describe('trackActivity — command routing → ActivityPause', () => {
      it('should call activityEngine.pauseActivity(userId) when ActivityPause is received', async () => {
        activityEngine.pauseActivity.mockReturnValue(
          makeActivityState({ isPaused: true }),
        );
        const { request$ } = await setupRoutingStream();

        request$.next({ activityPause: {} });
        await flushMicrotasks();

        expect(activityEngine.pauseActivity).toHaveBeenCalledWith(
          'user-1',
          undefined,
        );
      });

      it('should emit sessionState ACTIVE with isPaused: true and moduleSessionId from the returned state on success', async () => {
        activityEngine.pauseActivity.mockReturnValue(
          makeActivityState({ sessionId: 'session-1', isPaused: true }),
        );
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityPause: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionState?.status).toBe(ActivityStatus.ACTIVE);
        expect(values[0]?.sessionState?.moduleSessionId).toBe('session-1');
        expect(values[0]?.sessionState?.isPaused).toBe(true);
      });

      it("should emit sessionError with code 'no_active_session' when pauseActivity throws new Error('no_active_session')", async () => {
        activityEngine.pauseActivity.mockImplementation(() => {
          throw new Error('no_active_session');
        });
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityPause: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('no_active_session');
      });

      it("should emit sessionError with code 'already_paused' when pauseActivity throws new Error('already_paused')", async () => {
        activityEngine.pauseActivity.mockImplementation(() => {
          throw new Error('already_paused');
        });
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityPause: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('already_paused');
      });

      it('should not emit a sessionState when pauseActivity throws', async () => {
        activityEngine.pauseActivity.mockImplementation(() => {
          throw new Error('no_active_session');
        });
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityPause: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionState).toBeUndefined();
      });
    });

    // ── Task 5: ActivityResume ──────────────────────────────────────────────

    describe('trackActivity — command routing → ActivityResume', () => {
      it('should call activityEngine.unpauseActivity(userId) when ActivityResume is received', async () => {
        activityEngine.unpauseActivity.mockReturnValue(
          makeActivityState({ isPaused: false }),
        );
        const { request$ } = await setupRoutingStream();

        request$.next({ activityResume: {} });
        await flushMicrotasks();

        expect(activityEngine.unpauseActivity).toHaveBeenCalledWith(
          'user-1',
          undefined,
        );
      });

      it('should emit sessionState ACTIVE with isPaused: false and moduleSessionId from the returned state on success', async () => {
        activityEngine.unpauseActivity.mockReturnValue(
          makeActivityState({ sessionId: 'session-1', isPaused: false }),
        );
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityResume: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionState?.status).toBe(ActivityStatus.ACTIVE);
        expect(values[0]?.sessionState?.moduleSessionId).toBe('session-1');
        expect(values[0]?.sessionState?.isPaused).toBe(false);
      });

      it("should emit sessionError with code 'no_active_session' when unpauseActivity throws new Error('no_active_session')", async () => {
        activityEngine.unpauseActivity.mockImplementation(() => {
          throw new Error('no_active_session');
        });
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityResume: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('no_active_session');
      });

      it("should emit sessionError with code 'not_paused' when unpauseActivity throws new Error('not_paused')", async () => {
        activityEngine.unpauseActivity.mockImplementation(() => {
          throw new Error('not_paused');
        });
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityResume: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('not_paused');
      });

      it('should not emit a sessionState when unpauseActivity throws', async () => {
        activityEngine.unpauseActivity.mockImplementation(() => {
          throw new Error('no_active_session');
        });
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityResume: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionState).toBeUndefined();
      });
    });

    // ── Task 6: Empty command and unhandled errors ──────────────────────────

    describe('trackActivity — command routing → empty / unhandled', () => {
      it('should emit sessionError INVALID_COMMAND when StateRequest has no command field set', async () => {
        const { request$, values } = await setupRoutingStream();

        request$.next({});
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('INVALID_COMMAND');
      });

      it('should not call any of the routing-dispatched activityEngine methods (startActivity, endActivity, stopActivity, pauseActivity, unpauseActivity) when StateRequest is empty', async () => {
        const { request$ } = await setupRoutingStream();

        jest.clearAllMocks();
        request$.next({});
        await flushMicrotasks();

        expect(activityEngine.startActivity).not.toHaveBeenCalled();
        expect(activityEngine.endActivity).not.toHaveBeenCalled();
        expect(activityEngine.stopActivity).not.toHaveBeenCalled();
        expect(activityEngine.pauseActivity).not.toHaveBeenCalled();
        expect(activityEngine.unpauseActivity).not.toHaveBeenCalled();
      });

      it('should emit sessionError INTERNAL_ERROR when a handler throws unexpectedly (e.g. activityEngine.endActivity rejects with a generic Error)', async () => {
        activityEngine.endActivity.mockRejectedValue(new Error('unexpected'));
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityEnd: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('INTERNAL_ERROR');
      });

      it('should keep the outer subscription open after emitting INTERNAL_ERROR (sub.closed === false, complete/error not called)', async () => {
        activityEngine.endActivity.mockRejectedValue(new Error('unexpected'));

        let completed = false;
        let errored = false;
        const request$ = new Subject<StateRequest>();
        const values: StateResponse[] = [];

        const sub = controller.trackActivity(request$, makeUser()).subscribe({
          next: (v) => values.push(v),
          error: () => {
            errored = true;
          },
          complete: () => {
            completed = true;
          },
        });

        await flushMicrotasks();
        // Drain connect-phase frames (mirrors setupRoutingStream) so values[0] is the command response
        values.length = 0;

        request$.next({ activityEnd: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('INTERNAL_ERROR');
        expect(sub.closed).toBe(false);
        expect(completed).toBe(false);
        expect(errored).toBe(false);

        sub.unsubscribe();
      });

      it('should continue routing subsequent commands after an INTERNAL_ERROR (next command after the failing one still produces a response)', async () => {
        activityEngine.endActivity.mockRejectedValueOnce(
          new Error('unexpected'),
        );
        activityEngine.stopActivity.mockResolvedValue(
          makeSession({ id: 'stop-session' }),
        );
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityEnd: {} });
        await flushMicrotasks();

        request$.next({ activityStop: {} });
        await flushMicrotasks();

        expect(values).toHaveLength(2);
        expect(values[0]?.sessionError?.code).toBe('INTERNAL_ERROR');
        expect(values[1]?.sessionState?.status).toBe(
          ActivityStatus.INTERRUPTED,
        );
      });
    });
  });
});
