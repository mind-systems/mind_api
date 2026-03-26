import { Controller, UseFilters } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import { JwtService } from '@nestjs/jwt';
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
import { SessionService } from '../users/service/session.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import type { JwtPayload } from '../users/interfaces/auth.interface';
// TODO: uncomment when 1.4 is merged
// import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
// import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';

@Controller()
@SyncServiceControllerMethods()
@UseFilters(GrpcExceptionFilter)
export class SyncGrpcController implements SyncServiceController {
  constructor(
    private readonly syncService: SyncService,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
  ) {}

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async getChanges(
    request: GetChangesRequest,
    metadata?: Metadata,
    // @GrpcCurrentUser() _user?: JwtPayload, // TODO: uncomment when 1.4 is merged
  ): Promise<GetChangesResponse> {
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

    const result = await this.syncService.getChanges(userId, request.after, request.limit);

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
