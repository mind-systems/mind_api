import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';
import {
  GetChangesRequest,
  GetChangesResponse,
} from '../../proto/generated/sync';
import { SyncService } from './sync.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class SyncGrpcController {
  constructor(
    private readonly syncService: SyncService,
  ) {}

  @GrpcMethod('SyncService', 'getChanges')
  async getChanges(
    @Payload() request: GetChangesRequest,
    @GrpcCurrentUser() user: JwtPayload,
  ): Promise<GetChangesResponse> {
    const result = await this.syncService.getChanges(user.sub, Number(request.after), request.limit);

    if ('fullResync' in result) {
      return { fullResync: true };
    }

    return {
      payload: {
        events: result.events.map((e) => ({
          id: e.id,
          entity: e.entity,
          refId: e.refId,
          action: e.action,
          createdAt: e.createdAt.toISOString(),
        })),
        cursor: result.cursor,
        hasMore: result.hasMore,
      },
    };
  }
}
