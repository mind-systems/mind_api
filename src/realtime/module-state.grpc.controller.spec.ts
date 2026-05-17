import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Subject, Subscriber } from 'rxjs';
import { ModuleStateGrpcController } from './module-state.grpc.controller';
import { ActivityStatus, StateRequest, StateResponse } from '../../proto/generated/module_state';
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
});
