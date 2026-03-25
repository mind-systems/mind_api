import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';
import { RateLimiterService } from '../services/rate-limiter.service';
import type { AuthenticatedSocket } from '../interfaces/authenticated-socket.interface';
import { RealtimeConfig } from '../constants/realtime-config';
import { WsErrorCode } from '../constants/ws-error-codes';

@Injectable()
export class WsRateLimitGuard implements CanActivate {
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(
    private readonly rateLimiterService: RateLimiterService,
    configService: ConfigService,
  ) {
    this.limit = configService.get<number>(
      RealtimeConfig.RATE_LIMIT_MAX_EVENTS,
      200,
    );
    this.windowMs = configService.get<number>(
      RealtimeConfig.RATE_LIMIT_WINDOW_MS,
      1000,
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    const allowed = this.rateLimiterService.consume(
      client.id,
      this.limit,
      this.windowMs,
    );
    if (!allowed) {
      throw new WsException({
        code: WsErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'Too many requests',
        timestamp: Date.now(),
      });
    }
    return true;
  }
}
