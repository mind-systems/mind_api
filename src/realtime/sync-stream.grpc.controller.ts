import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Observable } from 'rxjs';
import {
  ChangeEvent,
  WatchChangesRequest,
} from '../../proto/generated/sync';
import { ChangeLogService, ChangesResult } from '../changelog/changelog.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';
import type { JwtPayload } from '../users/interfaces/auth.interface';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class SyncStreamGrpcController {
  constructor(private readonly changeLogService: ChangeLogService) {}

  @GrpcMethod('SyncService', 'watchChanges')
  watchChanges(
    request: WatchChangesRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Observable<ChangeEvent> {
    return new Observable<ChangeEvent>((subscriber) => {
      if (!user) {
        subscriber.error(
          new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' }),
        );
        return;
      }

      const userId = user.sub;

      const replay = async (): Promise<void> => {
        if (request.afterId === undefined) {
          // Live-only mode: skip replay, stream stays open
          return;
        }

        let cursor = request.afterId;

        const minEventId = await this.changeLogService.getMinEventId();
        if (minEventId !== null && cursor !== 0 && cursor < minEventId) {
          subscriber.error(
            new RpcException({
              code: GrpcStatus.FAILED_PRECONDITION,
              message: 'cursor too old, full resync required',
            }),
          );
          return;
        }

        let hasMore = true;
        while (hasMore) {
          const result: ChangesResult = await this.changeLogService.getChanges(userId, cursor, 100);
          subscriber.next({
            events: result.events.map((e) => ({
              id: e.id,
              entity: e.entity,
              refId: e.refId,
              action: e.action,
              createdAt: e.createdAt.toISOString(),
            })),
          });
          cursor = result.cursor;
          hasMore = result.hasMore;
        }
        // Replay complete — stream stays open for live push phase
      };

      replay().catch((err: unknown) => subscriber.error(err));

      subscriber.add(() => {
        // Teardown: placeholder for live phase stream deregistration
      });
    });
  }
}
