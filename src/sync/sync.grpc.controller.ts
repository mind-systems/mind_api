import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import { Observable, throwError } from 'rxjs';
import {
  ChangeEvent,
  GetChangesRequest,
  GetChangesResponse,
  SyncServiceController,
  SyncServiceControllerMethods,
  WatchChangesRequest,
} from '../../proto/generated/sync';
import { SyncService } from './sync.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';

@Controller()
@SyncServiceControllerMethods()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class SyncGrpcController implements SyncServiceController {
  constructor(
    private readonly syncService: SyncService,
  ) {}

  async getChanges(
    request: GetChangesRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<GetChangesResponse> {
    const result = await this.syncService.getChanges(user!.sub, request.after, request.limit);

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

  watchChanges(_request: WatchChangesRequest, _metadata?: Metadata): Observable<ChangeEvent> {
    return throwError(
      () =>
        new RpcException({
          code: GrpcStatus.UNIMPLEMENTED,
          message: 'WatchChanges not implemented yet (Phase 3.3)',
        }),
    );
  }
}
