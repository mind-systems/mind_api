import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Subject, Subscriber } from 'rxjs';
import { ModuleStateGrpcController } from './module-state.grpc.controller';
import { ActivityStatus, ActivityType, StateRequest, StateResponse } from '../../proto/generated/module_state';
import type { JwtPayload } from '../users/interfaces/auth.interface';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeUser(overrides?: Partial<JwtPayload>): JwtPayload {
  return { sub: 'user-1', email: 'test@example.com', name: 'Test User', ...overrides };
}

function makeSession(overrides?: Partial<{ id: string }>) {
  return { id: 'session-1', ...overrides } as any;
}

function makeActivityEngine() {
  return {
    handleReconnect: jest.fn().mockResolvedValue(null),
    getActiveSession: jest.fn().mockReturnValue(undefined),
    handleTransportDisconnect: jest.fn().mockResolvedValue(undefined),
    startActivity: jest.fn().mockResolvedValue(makeSession()),
    endActivity: jest.fn().mockResolvedValue(null),
    stopActivity: jest.fn().mockResolvedValue(null),
    pauseActivity: jest.fn(),
    unpauseActivity: jest.fn(),
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
    deregister: jest.fn(),
    closeAll: jest.fn(),
  };
}

function makeConfigService() {
  return {
    get: jest.fn().mockReturnValue(10),
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

  beforeEach(() => {
    activityEngine = makeActivityEngine();
    rateLimiterService = makeRateLimiterService();
    activeStreamRegistry = makeActiveStreamRegistry();
    configService = makeConfigService();

    controller = new ModuleStateGrpcController(
      activityEngine as any,
      rateLimiterService as any,
      activeStreamRegistry as any,
      configService as any,
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
      const sub = controller.trackActivity(request$, user).subscribe({ error: () => {} });
      expect(activeStreamRegistry.register).toHaveBeenCalledWith(
        user.sub,
        expect.any(Subscriber),
      );
      sub.unsubscribe();
    });
  });

  // ── Task 3: Reconnect path ────────────────────────────────────────────────

  describe('trackActivity — reconnect path', () => {
    it('should emit StateResponse.sessionState with status RESUMED and isPaused false when handleReconnect returns a session', async () => {
      activityEngine.handleReconnect.mockResolvedValue(makeSession({ id: 'resumed-session' }));

      const user = makeUser();
      const request$ = new Subject<StateRequest>();
      const values: StateResponse[] = [];
      const sub = controller.trackActivity(request$, user).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      await flushMicrotasks();

      expect(values).toHaveLength(1);
      expect(values[0].sessionState).toMatchObject({
        status: ActivityStatus.RESUMED,
        isPaused: false,
      });

      sub.unsubscribe();
    });

    it('should include the resumed session id as moduleSessionId in the emitted StateResponse', async () => {
      activityEngine.handleReconnect.mockResolvedValue(makeSession({ id: 'my-session-id' }));

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

    it('should not emit any StateResponse during setup when handleReconnect returns null', async () => {
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
      const sub = controller.trackActivity(request$, user).subscribe({ error: () => {} });

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
      activeStreamRegistry.register = jest.fn((_userId, sub: Subscriber<StateResponse>) => {
        capturedSubscriber = sub;
      });

      // Make handleReconnect a deferred promise so we control when setup() resumes
      let resolveReconnect!: (val: any) => void;
      activityEngine.handleReconnect = jest.fn(
        () => new Promise<any>((resolve) => { resolveReconnect = resolve; }),
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
        complete: () => { completed = true; },
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
        expect.any(Subscriber),
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
        expect.any(Subscriber),
      );
    });

    it('should call activityEngine.handleTransportDisconnect(userId) on teardown', async () => {
      const user = makeUser();
      const { sub } = await setupConnectedStream(user);

      sub.unsubscribe();

      expect(activityEngine.handleTransportDisconnect).toHaveBeenCalledWith(user.sub);
    });

    it("should call rateLimiterService.evict('activity-start:{userId}') on teardown", async () => {
      const user = makeUser();
      const { sub } = await setupConnectedStream(user);

      sub.unsubscribe();

      expect(rateLimiterService.evict).toHaveBeenCalledWith(`activity-start:${user.sub}`);
    });

    it('should invoke teardown actions in order: deregister → handleTransportDisconnect → evict', async () => {
      const callOrder: string[] = [];
      activeStreamRegistry.deregister = jest.fn(() => { callOrder.push('deregister'); });
      activityEngine.handleTransportDisconnect = jest.fn(() => {
        callOrder.push('handleTransportDisconnect');
        return Promise.resolve();
      });
      rateLimiterService.evict = jest.fn(() => { callOrder.push('evict'); });

      const user = makeUser();
      const { sub } = await setupConnectedStream(user);

      sub.unsubscribe();

      // handleTransportDisconnect is inside an async IIFE — its invocation is still
      // synchronous (it starts the async work) so the order is deterministic.
      expect(callOrder).toEqual(['deregister', 'handleTransportDisconnect', 'evict']);
    });

    it('should swallow errors thrown by handleTransportDisconnect and not propagate them to the caller', async () => {
      activityEngine.handleTransportDisconnect.mockRejectedValue(new Error('network fail'));

      const user = makeUser();
      const { sub } = await setupConnectedStream(user);

      expect(() => sub.unsubscribe()).not.toThrow();

      // Allow the rejected promise to settle without crashing the test
      await flushMicrotasks();
    });

    it('should still call rateLimiterService.evict when handleTransportDisconnect rejects', async () => {
      activityEngine.handleTransportDisconnect.mockRejectedValue(new Error('network fail'));

      const user = makeUser();
      const { sub } = await setupConnectedStream(user);

      sub.unsubscribe();

      // evict is synchronous and runs right after starting the async IIFE
      expect(rateLimiterService.evict).toHaveBeenCalledWith(`activity-start:${user.sub}`);

      await flushMicrotasks();
    });

    it('should run teardown when the request observable completes', async () => {
      const user = makeUser();
      const { request$ } = await setupConnectedStream(user);

      request$.complete();

      expect(activeStreamRegistry.deregister).toHaveBeenCalledWith(
        user.sub,
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
        expect.any(Subscriber),
      );
    });
  });

  // ── Task 6: handleSessionRevoked ─────────────────────────────────────────

  describe('handleSessionRevoked', () => {
    it('should call activityEngine.stopActivity(payload.userId)', async () => {
      await controller.handleSessionRevoked({ userId: 'user-1' });
      expect(activityEngine.stopActivity).toHaveBeenCalledWith('user-1');
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
      await expect(controller.handleSessionRevoked({ userId: 'user-1' })).resolves.toBeUndefined();
    });

    it('should call stopActivity before closeAll', async () => {
      const callOrder: string[] = [];
      activityEngine.stopActivity = jest.fn(async () => { callOrder.push('stopActivity'); return null; });
      activeStreamRegistry.closeAll = jest.fn(() => { callOrder.push('closeAll'); });

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

      it('should emit sessionState ACTIVE with existing moduleSessionId when activityEngine.getActiveSession returns a session', async () => {
        activityEngine.getActiveSession.mockReturnValue(makeActivityState({ sessionId: 'session-1' }));
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityStart: { activityType: ActivityType.BREATH } });
        await flushMicrotasks();

        expect(values[0]?.sessionState?.status).toBe(ActivityStatus.ACTIVE);
        expect(values[0]?.sessionState?.moduleSessionId).toBe('session-1');
      });

      it('should not call activityEngine.startActivity when an active session already exists', async () => {
        activityEngine.getActiveSession.mockReturnValue(makeActivityState({ sessionId: 'session-1' }));
        const { request$ } = await setupRoutingStream();

        request$.next({ activityStart: { activityType: ActivityType.BREATH } });
        await flushMicrotasks();

        expect(activityEngine.startActivity).not.toHaveBeenCalled();
      });

      it('should emit sessionError INVALID_ACTIVITY_TYPE when cmd.activityType is unsupported (e.g. ACTIVITY_TYPE_UNSPECIFIED)', async () => {
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityStart: { activityType: ActivityType.ACTIVITY_TYPE_UNSPECIFIED } });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('INVALID_ACTIVITY_TYPE');
      });

      it('should not call activityEngine.startActivity when activityType is unsupported', async () => {
        const { request$ } = await setupRoutingStream();

        request$.next({ activityStart: { activityType: ActivityType.ACTIVITY_TYPE_UNSPECIFIED } });
        await flushMicrotasks();

        expect(activityEngine.startActivity).not.toHaveBeenCalled();
      });

      it('should call activityEngine.startActivity(userId, { activityType: BREATH, activityRefId: cmd.refId }) on the happy path', async () => {
        const { request$ } = await setupRoutingStream();

        request$.next({ activityStart: { activityType: ActivityType.BREATH, refId: 'ref-123' } });
        await flushMicrotasks();

        expect(activityEngine.startActivity).toHaveBeenCalledWith('user-1', {
          activityType: 'breath',
          activityRefId: 'ref-123',
        });
      });

      it('should emit sessionState ACTIVE with moduleSessionId from the returned session on the happy path', async () => {
        activityEngine.startActivity.mockResolvedValue(makeSession({ id: 'new-session' }));
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityStart: { activityType: ActivityType.BREATH } });
        await flushMicrotasks();

        expect(values[0]?.sessionState?.status).toBe(ActivityStatus.ACTIVE);
        expect(values[0]?.sessionState?.moduleSessionId).toBe('new-session');
      });

      it('should forward cmd.refId to the engine as activityRefId (string value preserved)', async () => {
        const { request$ } = await setupRoutingStream();

        request$.next({ activityStart: { activityType: ActivityType.BREATH, refId: 'my-ref-id' } });
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

      it('should omit the isPaused field from the emitted sessionState when returning an existing session', async () => {
        activityEngine.getActiveSession.mockReturnValue(makeActivityState({ sessionId: 'session-1' }));
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

        expect(activityEngine.endActivity).toHaveBeenCalledWith('user-1');
      });

      it('should emit sessionState COMPLETED with moduleSessionId from the returned session', async () => {
        activityEngine.endActivity.mockResolvedValue(makeSession({ id: 'ended-session' }));
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
        activityEngine.endActivity.mockResolvedValue(makeSession({ id: 'ended-session' }));
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

        expect(activityEngine.stopActivity).toHaveBeenCalledWith('user-1');
      });

      it('should emit sessionState INTERRUPTED with moduleSessionId from the returned session', async () => {
        activityEngine.stopActivity.mockResolvedValue(makeSession({ id: 'stopped-session' }));
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityStop: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionState?.status).toBe(ActivityStatus.INTERRUPTED);
        expect(values[0]?.sessionState?.moduleSessionId).toBe('stopped-session');
      });

      it('should not emit any StateResponse when stopActivity resolves to null', async () => {
        activityEngine.stopActivity.mockResolvedValue(null);
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityStop: {} });
        await flushMicrotasks();

        expect(values).toHaveLength(0);
      });

      it('should omit the isPaused field from the emitted sessionState on INTERRUPTED', async () => {
        activityEngine.stopActivity.mockResolvedValue(makeSession({ id: 'stopped-session' }));
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
        activityEngine.pauseActivity.mockReturnValue(makeActivityState({ isPaused: true }));
        const { request$ } = await setupRoutingStream();

        request$.next({ activityPause: {} });
        await flushMicrotasks();

        expect(activityEngine.pauseActivity).toHaveBeenCalledWith('user-1');
      });

      it('should emit sessionState ACTIVE with isPaused: true and moduleSessionId from the returned state on success', async () => {
        activityEngine.pauseActivity.mockReturnValue(makeActivityState({ sessionId: 'session-1', isPaused: true }));
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityPause: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionState?.status).toBe(ActivityStatus.ACTIVE);
        expect(values[0]?.sessionState?.moduleSessionId).toBe('session-1');
        expect(values[0]?.sessionState?.isPaused).toBe(true);
      });

      it("should emit sessionError with code 'no_active_session' when pauseActivity throws new Error('no_active_session')", async () => {
        activityEngine.pauseActivity.mockImplementation(() => { throw new Error('no_active_session'); });
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityPause: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('no_active_session');
      });

      it("should emit sessionError with code 'already_paused' when pauseActivity throws new Error('already_paused')", async () => {
        activityEngine.pauseActivity.mockImplementation(() => { throw new Error('already_paused'); });
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityPause: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('already_paused');
      });

      it('should not emit a sessionState when pauseActivity throws', async () => {
        activityEngine.pauseActivity.mockImplementation(() => { throw new Error('no_active_session'); });
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityPause: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionState).toBeUndefined();
      });
    });

    // ── Task 5: ActivityResume ──────────────────────────────────────────────

    describe('trackActivity — command routing → ActivityResume', () => {
      it('should call activityEngine.unpauseActivity(userId) when ActivityResume is received', async () => {
        activityEngine.unpauseActivity.mockReturnValue(makeActivityState({ isPaused: false }));
        const { request$ } = await setupRoutingStream();

        request$.next({ activityResume: {} });
        await flushMicrotasks();

        expect(activityEngine.unpauseActivity).toHaveBeenCalledWith('user-1');
      });

      it('should emit sessionState ACTIVE with isPaused: false and moduleSessionId from the returned state on success', async () => {
        activityEngine.unpauseActivity.mockReturnValue(makeActivityState({ sessionId: 'session-1', isPaused: false }));
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityResume: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionState?.status).toBe(ActivityStatus.ACTIVE);
        expect(values[0]?.sessionState?.moduleSessionId).toBe('session-1');
        expect(values[0]?.sessionState?.isPaused).toBe(false);
      });

      it("should emit sessionError with code 'no_active_session' when unpauseActivity throws new Error('no_active_session')", async () => {
        activityEngine.unpauseActivity.mockImplementation(() => { throw new Error('no_active_session'); });
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityResume: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('no_active_session');
      });

      it("should emit sessionError with code 'not_paused' when unpauseActivity throws new Error('not_paused')", async () => {
        activityEngine.unpauseActivity.mockImplementation(() => { throw new Error('not_paused'); });
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityResume: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('not_paused');
      });

      it('should not emit a sessionState when unpauseActivity throws', async () => {
        activityEngine.unpauseActivity.mockImplementation(() => { throw new Error('no_active_session'); });
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
          error: () => { errored = true; },
          complete: () => { completed = true; },
        });

        await flushMicrotasks();

        request$.next({ activityEnd: {} });
        await flushMicrotasks();

        expect(values[0]?.sessionError?.code).toBe('INTERNAL_ERROR');
        expect(sub.closed).toBe(false);
        expect(completed).toBe(false);
        expect(errored).toBe(false);

        sub.unsubscribe();
      });

      it('should continue routing subsequent commands after an INTERNAL_ERROR (next command after the failing one still produces a response)', async () => {
        activityEngine.endActivity.mockRejectedValueOnce(new Error('unexpected'));
        activityEngine.stopActivity.mockResolvedValue(makeSession({ id: 'stop-session' }));
        const { request$, values } = await setupRoutingStream();

        request$.next({ activityEnd: {} });
        await flushMicrotasks();

        request$.next({ activityStop: {} });
        await flushMicrotasks();

        expect(values).toHaveLength(2);
        expect(values[0]?.sessionError?.code).toBe('INTERNAL_ERROR');
        expect(values[1]?.sessionState?.status).toBe(ActivityStatus.INTERRUPTED);
      });
    });
  });
});
