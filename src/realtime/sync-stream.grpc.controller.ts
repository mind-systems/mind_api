import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { GrpcMethod, Payload, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Observable } from 'rxjs';
import {
  ChangeEvent,
  SyncEventDto,
  WatchChangesRequest,
} from '../../proto/generated/sync';
import { ChangeLogService, ChangesResult } from '../changelog/changelog.service';
import { SyncStreamService } from './services/sync-stream.service';
import { ActiveStreamRegistry } from './services/active-stream-registry.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';
import type { JwtPayload } from '../users/interfaces/auth.interface';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class SyncStreamGrpcController {
  constructor(
    private readonly changeLogService: ChangeLogService,
    private readonly syncStreamService: SyncStreamService,
    private readonly activeStreamRegistry: ActiveStreamRegistry,
  ) {}

  @GrpcMethod('SyncService', 'watchChanges')
  watchChanges(
    @Payload() request: WatchChangesRequest,
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

      this.activeStreamRegistry.register(userId, subscriber);

      // liveBuffer holds events that arrive during replay and are flushed once replay ends.
      const liveBuffer: SyncEventDto[] = [];
      let isDirect = false;
      // Hoisted so pushFn's direct-mode path can filter out events already sent by replay.
      let lastReplayedCursor = 0;

      // Step A — Register listener BEFORE replay to guarantee no gap between replay end
      // and live push start. Events are buffered into liveBuffer until replay completes.
      const pushFn = (events: Array<{ id: number; entity: string; refId: string; action: string }>): void => {
        // createdAt approximation: CHANGE_EVENT_LOGGED fires immediately after DB insert,
        // so the timestamp difference from the DB createdAt column is negligible.
        const stamped: SyncEventDto[] = events.map((e) => ({
          ...e,
          createdAt: new Date().toISOString(),
        }));
        if (isDirect) {
          // Filter events whose debounce timer fired after replay completed but whose id
          // was already covered by the replay batch (300ms window straddles the boundary).
          const fresh = stamped.filter((e) => e.id > lastReplayedCursor);
          if (fresh.length > 0) {
            subscriber.next({ events: fresh });
          }
        } else {
          liveBuffer.push(...stamped);
        }
      };

      this.syncStreamService.register(userId, pushFn);

      const replay = async (): Promise<void> => {
        if (request.afterId === undefined) {
          // Live-only mode: no replay needed; switch directly to live push.
          isDirect = true;
          return;
        }

        let cursor = request.afterId;

        const minEventId = await this.changeLogService.getMinEventId();
        if (minEventId !== null && cursor !== 0 && cursor < minEventId) {
          // Cursor is older than the oldest retained event — client must full-resync.
          // Explicit deregister before error — teardown will call deregister again (idempotent).
          this.syncStreamService.deregister(userId, pushFn);
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
          if (subscriber.closed) return;
          const result: ChangesResult = await this.changeLogService.getChanges(userId, cursor, 100);
          // Skip empty batches to avoid sending no-op messages to the client.
          if (result.events.length > 0) {
            subscriber.next({
              events: result.events.map((e) => ({
                id: e.id,
                entity: e.entity,
                refId: e.refId,
                action: e.action,
                createdAt: e.createdAt.toISOString(),
              })),
            });
          }
          cursor = result.cursor;
          lastReplayedCursor = result.cursor;
          hasMore = result.hasMore;
        }

        // Step C — Flush events that arrived during replay.
        // Filter out any events already covered by replay (id <= lastReplayedCursor).
        const pending = liveBuffer.splice(0).filter((e) => e.id > lastReplayedCursor);
        if (pending.length > 0) {
          subscriber.next({ events: pending });
        }

        // Switch to direct mode — subsequent pushFn calls go straight to subscriber.next().
        isDirect = true;
      };

      replay().catch((err: unknown) => subscriber.error(err));

      // Step D — Teardown: deregister the live listener and any pending debounce timer.
      subscriber.add(() => {
        this.activeStreamRegistry.deregister(userId, subscriber);
        this.syncStreamService.deregister(userId, pushFn);
      });
    });
  }
}
