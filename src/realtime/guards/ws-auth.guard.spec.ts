import { ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { WsAuthGuard } from './ws-auth.guard';

describe('WsAuthGuard', () => {
  let guard: WsAuthGuard;

  beforeEach(() => {
    guard = new WsAuthGuard();
  });

  function createContext(userId?: string) {
    const client = { id: 'socket-1', data: { userId } };
    return {
      switchToWs: () => ({ getClient: () => client }),
      client,
    };
  }

  it('returns true when userId is set by middleware', () => {
    const ctx = createContext('user-1');
    expect(guard.canActivate(ctx as unknown as ExecutionContext)).toBe(true);
  });

  it('throws WsException when userId is missing', () => {
    const ctx = createContext(undefined);
    expect(() => guard.canActivate(ctx as unknown as ExecutionContext)).toThrow(
      WsException,
    );
  });
});
