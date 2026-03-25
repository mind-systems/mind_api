import { TelemetryGateway } from './telemetry.gateway';
import { ActivityEngine } from '../services/activity-engine.service';
import { StreamEngine } from '../services/stream-engine.service';
import { RateLimiterService } from '../services/rate-limiter.service';
import { WsAuthMiddleware } from '../middleware/ws-auth.middleware';
import { AuthenticatedSocket } from '../interfaces/authenticated-socket.interface';
import { ActivityType } from '../enums/activity-type.enum';
import { DATA_ACK } from '../events/telemetry.events';
import { SESSION_ERROR } from '../events/live.events';
import { DataStreamDto } from '../dto/data-stream.dto';
import { WsErrorCode } from '../constants/ws-error-codes';

function makeSocket(
  userId: string | undefined,
  id = 'socket-1',
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
    getActiveSession: jest.fn(),
  } as unknown as jest.Mocked<ActivityEngine>;
}

function makeStreamEngine(): jest.Mocked<StreamEngine> {
  return {
    push: jest.fn(),
    maxSamplesPerSecond: 50,
  } as unknown as jest.Mocked<StreamEngine>;
}

function makeDto(overrides: Partial<DataStreamDto> = {}): DataStreamDto {
  return {
    sessionId: 'session-1',
    timestamp: 1000,
    data: { value: 42 },
    ...overrides,
  };
}

function makeRateLimiterService(): jest.Mocked<RateLimiterService> {
  return {
    consume: jest.fn().mockReturnValue(true),
    evict: jest.fn(),
  } as unknown as jest.Mocked<RateLimiterService>;
}

describe('TelemetryGateway', () => {
  let gateway: TelemetryGateway;
  let activityEngine: jest.Mocked<ActivityEngine>;
  let streamEngine: jest.Mocked<StreamEngine>;

  beforeEach(() => {
    activityEngine = makeActivityEngine();
    streamEngine = makeStreamEngine();
    const wsAuthMiddleware = {
      middleware: jest.fn(),
    } as unknown as jest.Mocked<WsAuthMiddleware>;

    gateway = new TelemetryGateway(
      activityEngine,
      streamEngine,
      makeRateLimiterService(),
      wsAuthMiddleware,
    );
  });

  describe('handleConnection', () => {
    it('disconnects unauthenticated client (no userId)', () => {
      const client = makeSocket(undefined);

      gateway.handleConnection(client);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('allows authenticated client through', () => {
      const client = makeSocket('user-1');

      gateway.handleConnection(client);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('handleDataStream', () => {
    it('accepted sample — emits data:ack with receivedCount and maxSamplesPerSecond', () => {
      const client = makeSocket('user-1');
      activityEngine.getActiveSession.mockReturnValue({
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        isPaused: false,
      });
      streamEngine.push.mockReturnValue({
        accepted: true,
        droppedCount: 0,
        totalReceived: 5,
      });

      gateway.handleDataStream(client, makeDto());

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(streamEngine.push).toHaveBeenCalledWith('session-1', {
        timestamp: 1000,
        data: { value: 42 },
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.emit).toHaveBeenCalledWith(
        DATA_ACK,
        expect.objectContaining({
          sessionId: 'session-1',
          receivedCount: 5,
          maxSamplesPerSecond: 50,
        }),
      );
      // droppedCount should be absent when 0
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const ackPayload = (client.emit as jest.Mock).mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(ackPayload.droppedCount).toBeUndefined();
    });

    it('dropped sample — emits data:ack with droppedCount set', () => {
      const client = makeSocket('user-1');
      activityEngine.getActiveSession.mockReturnValue({
        sessionId: 'session-1',
        activityType: ActivityType.BREATH,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        isPaused: false,
      });
      streamEngine.push.mockReturnValue({
        accepted: false,
        droppedCount: 1,
        totalReceived: 10,
      });

      gateway.handleDataStream(client, makeDto());

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const ackPayload = (client.emit as jest.Mock).mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(ackPayload.droppedCount).toBe(1);
    });

    it('no active session — emits session:error with code NO_SESSION', () => {
      const client = makeSocket('user-1');
      activityEngine.getActiveSession.mockReturnValue(undefined);

      gateway.handleDataStream(client, makeDto());

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.emit).toHaveBeenCalledWith(
        SESSION_ERROR,
        expect.objectContaining({ code: WsErrorCode.NO_SESSION }),
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(streamEngine.push).not.toHaveBeenCalled();
    });

    it('sessionId mismatch — emits session:error with code SESSION_MISMATCH', () => {
      const client = makeSocket('user-1');
      activityEngine.getActiveSession.mockReturnValue({
        sessionId: 'different-session',
        activityType: ActivityType.BREATH,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        isPaused: false,
      });

      gateway.handleDataStream(client, makeDto({ sessionId: 'session-1' }));

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.emit).toHaveBeenCalledWith(
        SESSION_ERROR,
        expect.objectContaining({ code: WsErrorCode.SESSION_MISMATCH }),
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(streamEngine.push).not.toHaveBeenCalled();
    });

    it('no userId on socket — returns without emitting', () => {
      const client = makeSocket(undefined);

      gateway.handleDataStream(client, makeDto());

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(client.emit).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(streamEngine.push).not.toHaveBeenCalled();
    });
  });
});
