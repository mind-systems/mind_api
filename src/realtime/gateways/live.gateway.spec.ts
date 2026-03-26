import { ConfigService } from '@nestjs/config';
import { LiveGateway } from './live.gateway';
import { StateStore } from '../state-store';
import { PresenceService } from '../services/presence.service';
import { ActivityEngine } from '../services/activity-engine.service';
import { RateLimiterService } from '../services/rate-limiter.service';
import { AuthenticatedSocket } from '../interfaces/authenticated-socket.interface';
import { ActivityType } from '../enums/activity-type.enum';
import { SessionStatus } from '../enums/session-status.enum';
import { LiveSession } from '../entities/live-session.entity';
import { ActivityStartDto } from '../dto/activity-start.dto';
import { SESSION_ERROR, SESSION_STATE } from '../events/live.events';
import { WsAuthMiddleware } from '../middleware/ws-auth.middleware';
import { WsErrorCode } from '../constants/ws-error-codes';

function makeSocket(
  userId: string | undefined,
  id: string,
): AuthenticatedSocket {
  return {
    id,
    data: { userId: userId as string },
    disconnect: jest.fn(),
    emit: jest.fn(),
  } as unknown as AuthenticatedSocket;
}

function makeActivityEngine(): jest.Mocked<ActivityEngine> {
  return {
    startActivity: jest.fn(),
    endActivity: jest.fn(),
    onDisconnect: jest.fn(),
    abandonActivity: jest.fn(),
    getActiveSession: jest.fn(),
    resumeActivity: jest.fn(),
    pauseActivity: jest.fn(),
    unpauseActivity: jest.fn(),
    handleReconnect: jest.fn(),
    handleTransportDisconnect: jest.fn(),
  } as unknown as jest.Mocked<ActivityEngine>;
}

describe('LiveGateway — single-connection policy', () => {
  let gateway: LiveGateway;
  let stateStore: StateStore;
  let presenceService: jest.Mocked<PresenceService>;
  let activityEngine: jest.Mocked<ActivityEngine>;
  let rateLimiterService: jest.Mocked<RateLimiterService>;
  let wsAuthMiddleware: jest.Mocked<WsAuthMiddleware>;

  function makeConfigService(): ConfigService {
    return {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
  }

  beforeEach(() => {
    stateStore = new StateStore();
    presenceService = {
      online: jest.fn(),
      background: jest.fn(),
      foreground: jest.fn(),
      offline: jest.fn(),
    } as unknown as jest.Mocked<PresenceService>;
    activityEngine = makeActivityEngine();
    activityEngine.onDisconnect.mockResolvedValue(undefined);
    activityEngine.endActivity.mockResolvedValue(null);
    activityEngine.handleReconnect.mockResolvedValue(null);
    activityEngine.handleTransportDisconnect.mockResolvedValue(undefined);
    rateLimiterService = {
      consume: jest.fn().mockReturnValue(true),
      evict: jest.fn(),
    } as unknown as jest.Mocked<RateLimiterService>;

    wsAuthMiddleware = {
      middleware: jest.fn(),
    } as unknown as jest.Mocked<WsAuthMiddleware>;

    gateway = new LiveGateway(
      stateStore,
      presenceService,
      activityEngine,
      rateLimiterService,
      wsAuthMiddleware,
      makeConfigService(),
    );
  });

  it('first connection — registers socket and calls presenceService.online()', () => {
    const client = makeSocket('user-1', 'socket-1');

    gateway.handleConnection(client);

    expect(stateStore.socketMap.get('user-1')).toBe(client);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(presenceService.online).toHaveBeenCalledWith('user-1', 'socket-1');
  });

  it('second connection same userId — evicts existing socket and registers new one', () => {
    const first = makeSocket('user-1', 'socket-1');
    const second = makeSocket('user-1', 'socket-2');

    gateway.handleConnection(first);
    gateway.handleConnection(second);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(first.disconnect).toHaveBeenCalledWith(true);
    expect(stateStore.socketMap.get('user-1')).toBe(second);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(presenceService.online).toHaveBeenCalledTimes(2);
  });

  it('handleDisconnect matching socketId — clears socketMap and calls presenceService.offline()', () => {
    const client = makeSocket('user-1', 'socket-1');
    gateway.handleConnection(client);

    gateway.handleDisconnect(client);

    expect(stateStore.socketMap.has('user-1')).toBe(false);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(presenceService.offline).toHaveBeenCalledWith('user-1');
  });

  it('handleDisconnect matching socketId — calls ActivityEngine.handleTransportDisconnect()', () => {
    const client = makeSocket('user-1', 'socket-1');
    gateway.handleConnection(client);

    gateway.handleDisconnect(client);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(activityEngine.handleTransportDisconnect).toHaveBeenCalledWith('user-1');
  });

  it('handleDisconnect non-matching socketId (evicted socket) — does NOT clear socketMap, does NOT call offline()', () => {
    const evicted = makeSocket('user-1', 'socket-1');
    const current = makeSocket('user-1', 'socket-2');

    gateway.handleConnection(evicted);
    gateway.handleConnection(current);

    // evicted socket fires disconnect after being kicked
    presenceService.offline.mockClear();
    gateway.handleDisconnect(evicted);

    expect(stateStore.socketMap.get('user-1')).toBe(current);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(presenceService.offline).not.toHaveBeenCalled();
  });

  it('handleDisconnect no userId — does not crash', () => {
    const client = makeSocket(undefined, 'socket-x');
    expect(() => gateway.handleDisconnect(client)).not.toThrow();
  });

  describe('presence event handlers', () => {
    it('handleBackground — calls presenceService.background() with correct userId', () => {
      const client = makeSocket('user-1', 'socket-1');
      gateway.handleBackground(client);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(presenceService.background).toHaveBeenCalledWith('user-1');
    });

    it('handleForeground — calls presenceService.foreground() with correct userId', () => {
      const client = makeSocket('user-1', 'socket-1');
      gateway.handleForeground(client);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(presenceService.foreground).toHaveBeenCalledWith('user-1');
    });

    it('handleBackground with no userId — does not crash', () => {
      const client = makeSocket(undefined, 'socket-x');
      expect(() => gateway.handleBackground(client)).not.toThrow();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(presenceService.background).not.toHaveBeenCalled();
    });
  });

  describe('activity event handlers', () => {
    function makeSession(id = 'session-1'): LiveSession {
      const now = new Date();
      return {
        id,
        userId: 'user-1',
        activityType: ActivityType.BREATH,
        status: SessionStatus.ACTIVE,
        startedAt: now,
        lastActivityAt: now,
        createdAt: now,
      } as LiveSession;
    }

    it('activity:start throttled — emits SESSION_ERROR with RATE_LIMIT_EXCEEDED', async () => {
      const client = makeSocket('user-1', 'socket-1');
      rateLimiterService.consume.mockReturnValue(false);
      const dto: ActivityStartDto = {
        activityType: ActivityType.BREATH,
      };

      await gateway.handleActivityStart(client, dto);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.emit).toHaveBeenCalledWith(SESSION_ERROR, {
        code: WsErrorCode.RATE_LIMIT_EXCEEDED,
        message: expect.any(String),
        timestamp: expect.any(Number),
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(activityEngine.startActivity).not.toHaveBeenCalled();
    });

    it('activity:start throttle persists across reconnect — evict is NOT called for user key on disconnect', () => {
      const client = makeSocket('user-1', 'socket-1');
      gateway.handleConnection(client);
      gateway.handleDisconnect(client);

      const evictCalls = rateLimiterService.evict.mock.calls.map((c) => c[0]);
      expect(evictCalls).not.toContain('activity-start:user-1');
      expect(evictCalls).toContain('socket-1');
    });

    it('activity:start — calls startActivity and emits SESSION_STATE with status=active', async () => {
      const client = makeSocket('user-1', 'socket-1');
      const session = makeSession();
      activityEngine.getActiveSession.mockReturnValue(undefined);
      activityEngine.startActivity.mockResolvedValue(session);
      const dto: ActivityStartDto = {
        activityType: ActivityType.BREATH,
      };

      await gateway.handleActivityStart(client, dto);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(activityEngine.startActivity).toHaveBeenCalledWith('user-1', dto);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.emit).toHaveBeenCalledWith(SESSION_STATE, {
        liveSessionId: 'session-1',
        status: SessionStatus.ACTIVE,
      });
    });

    it('activity:start when session already active — startActivity NOT called, SESSION_STATE emitted with existing sessionId', async () => {
      const client = makeSocket('user-1', 'socket-1');
      activityEngine.getActiveSession.mockReturnValue({
        sessionId: 'existing-session',
        activityType: ActivityType.BREATH,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        isPaused: false,
      });
      const dto: ActivityStartDto = {
        activityType: ActivityType.BREATH,
      };

      await gateway.handleActivityStart(client, dto);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(activityEngine.startActivity).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.emit).toHaveBeenCalledWith(SESSION_STATE, {
        liveSessionId: 'existing-session',
        status: SessionStatus.ACTIVE,
      });
    });

    it('activity:end with active session — endActivity called, SESSION_STATE with completed emitted', async () => {
      const client = makeSocket('user-1', 'socket-1');
      const session = makeSession();
      activityEngine.endActivity.mockResolvedValue({
        ...session,
        status: SessionStatus.COMPLETED,
      });

      await gateway.handleActivityEnd(client);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(activityEngine.endActivity).toHaveBeenCalledWith('user-1');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.emit).toHaveBeenCalledWith(SESSION_STATE, {
        liveSessionId: 'session-1',
        status: SessionStatus.COMPLETED,
      });
    });

    it('activity:end with no session — no emit', async () => {
      const client = makeSocket('user-1', 'socket-1');
      activityEngine.endActivity.mockResolvedValue(null);

      await gateway.handleActivityEnd(client);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.emit).not.toHaveBeenCalled();
    });
  });

  describe('reconnect flow', () => {
    function makeSession(id = 'session-1'): LiveSession {
      const now = new Date();
      return {
        id,
        userId: 'user-1',
        activityType: ActivityType.BREATH,
        status: SessionStatus.ACTIVE,
        startedAt: now,
        lastActivityAt: now,
        createdAt: now,
      } as LiveSession;
    }

    it('handleConnection with disconnected session — handleReconnect called, emits session:state resumed', async () => {
      const client = makeSocket('user-1', 'socket-1');
      const session = makeSession();
      activityEngine.handleReconnect.mockResolvedValue(session);

      gateway.handleConnection(client);
      // Wait for the async handleReconnect promise (setImmediate drains the microtask + I/O queue)
      await new Promise<void>((r) => setImmediate(r));

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(activityEngine.handleReconnect).toHaveBeenCalledWith('user-1');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.emit).toHaveBeenCalledWith(SESSION_STATE, {
        liveSessionId: 'session-1',
        status: SessionStatus.RESUMED,
        isPaused: false,
      });
    });

    it('handleConnection with no pending session — handleReconnect called, SESSION_STATE not emitted', async () => {
      const client = makeSocket('user-1', 'socket-1');
      activityEngine.handleReconnect.mockResolvedValue(null);

      gateway.handleConnection(client);
      await new Promise<void>((r) => setImmediate(r));

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(activityEngine.handleReconnect).toHaveBeenCalledWith('user-1');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.emit).not.toHaveBeenCalledWith(SESSION_STATE, expect.anything());
    });

    it('handleDisconnect — calls handleTransportDisconnect', async () => {
      const client = makeSocket('user-1', 'socket-1');
      gateway.handleConnection(client);

      gateway.handleDisconnect(client);
      // Wait for the async handleTransportDisconnect promise
      await new Promise<void>((r) => setImmediate(r));

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(activityEngine.handleTransportDisconnect).toHaveBeenCalledWith('user-1');
    });
  });
});
