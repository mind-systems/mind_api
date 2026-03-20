import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';
import { WsRateLimitGuard } from './ws-rate-limit.guard';
import { RateLimiterService } from '../services/rate-limiter.service';
import { WsErrorCode } from '../constants/ws-error-codes';

describe('WsRateLimitGuard', () => {
  let guard: WsRateLimitGuard;
  let rateLimiterService: jest.Mocked<Pick<RateLimiterService, 'consume'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;

  function buildContext(clientId = 'socket-1') {
    const client = { id: clientId, data: {} };
    return {
      switchToWs: () => ({ getClient: () => client }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    rateLimiterService = { consume: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };
    guard = new WsRateLimitGuard(
      rateLimiterService as unknown as RateLimiterService,
      configService as unknown as ConfigService,
    );
  });

  it('returns true when under the limit', () => {
    rateLimiterService.consume.mockReturnValue(true);
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('throws WsException with structured payload when over the limit', () => {
    rateLimiterService.consume.mockReturnValue(false);
    let thrown: WsException | undefined;
    try {
      guard.canActivate(buildContext());
    } catch (err) {
      thrown = err as WsException;
    }
    expect(thrown).toBeInstanceOf(WsException);
    const error = thrown?.getError() as {
      code: string;
      message: string;
      timestamp: number;
    };
    expect(error.code).toBe(WsErrorCode.RATE_LIMIT_EXCEEDED);
    expect(error.message).toBe('Too many requests');
    expect(typeof error.timestamp).toBe('number');
  });
});
