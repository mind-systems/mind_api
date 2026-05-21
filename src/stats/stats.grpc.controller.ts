import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  GetStatsRequest,
  GetStatsResponse,
  StatsServiceController,
  StatsServiceControllerMethods,
} from '../../proto/generated/stats';
import { StatsService } from './stats.service';
import { Payload } from '@nestjs/microservices';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';

@Controller()
@StatsServiceControllerMethods()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class StatsGrpcController implements StatsServiceController {
  constructor(private readonly statsService: StatsService) {}

  async getStats(
    @Payload() _request: GetStatsRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<GetStatsResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }

    const result = await this.statsService.getStats(user.sub);

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
