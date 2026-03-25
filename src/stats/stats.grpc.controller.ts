import { Controller, UseFilters } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import { JwtService } from '@nestjs/jwt';
import {
  GetStatsRequest,
  GetStatsResponse,
  StatsServiceController,
  StatsServiceControllerMethods,
} from '../../proto/generated/stats';
import { StatsService } from './stats.service';
import { SessionService } from '../users/service/session.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import type { JwtPayload } from '../users/interfaces/auth.interface';
// TODO: uncomment when 1.4 is merged
// import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
// import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';

@Controller()
@StatsServiceControllerMethods()
@UseFilters(GrpcExceptionFilter)
export class StatsGrpcController implements StatsServiceController {
  constructor(
    private readonly statsService: StatsService,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
  ) {}

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async getStats(
    _request: GetStatsRequest,
    metadata?: Metadata,
    // @GrpcCurrentUser() _user?: JwtPayload, // TODO: uncomment when 1.4 is merged
  ): Promise<GetStatsResponse> {
    const raw = metadata?.get('authorization')[0]?.toString();
    const token = raw?.startsWith('Bearer ') ? raw.slice(7) : raw;
    if (!token) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing authorization metadata',
      });
    }

    let userId: string;
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      userId = payload.sub;
    } catch {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Invalid authorization token',
      });
    }

    const isValid = await this.sessionService.isValid(token);
    if (!isValid) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Session not found or revoked',
      });
    }

    const result = await this.statsService.getStats(userId);

    return {
      totalSessions: result.totalSessions,
      totalDurationSeconds: result.totalDurationSeconds,
      currentStreak: result.currentStreak,
      longestStreak: result.longestStreak,
      lastSessionDate: result.lastSessionDate ?? undefined,
      maxCompletedComplexity: result.maxCompletedComplexity,
    };
  }
}
