import {
  Controller,
  Logger,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { Payload, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Observable } from 'rxjs';
import {
  StreamSample,
  StreamResponse,
  ModuleInstructionStreamServiceControllerMethods,
} from '../../proto/generated/module_instruction_stream';
import { StreamEngine } from './services/stream-engine.service';
import { ActivityEngine } from './services/activity-engine.service';
import { ActiveStreamRegistry } from './services/active-stream-registry.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';
import { StreamDataType } from './constants/stream-data-types';
import type { JwtPayload } from '../users/interfaces/auth.interface';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
@ModuleInstructionStreamServiceControllerMethods()
export class ModuleInstructionStreamGrpcController {
  private readonly logger = new Logger(
    ModuleInstructionStreamGrpcController.name,
  );

  constructor(
    private readonly streamEngine: StreamEngine,
    private readonly activityEngine: ActivityEngine,
    private readonly activeStreamRegistry: ActiveStreamRegistry,
  ) {}

  streamData(
    @Payload() request: Observable<StreamSample>,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Observable<StreamResponse> {
    return new Observable<StreamResponse>((subscriber) => {
      if (!user) {
        subscriber.error(
          new RpcException({
            code: GrpcStatus.UNAUTHENTICATED,
            message: 'Missing user context',
          }),
        );
        return;
      }

      const userId = user.sub;

      this.activeStreamRegistry.register(userId, subscriber);

      const sub = request.subscribe({
        next: (msg: StreamSample) => {
          try {
            if (!msg.sessionId) {
              subscriber.next({
                error: {
                  code: 'INVALID_ARGUMENT',
                  message: 'Missing sessionId',
                  timestamp: Date.now(),
                },
              });
              return;
            }

            const session = this.activityEngine.getActiveSession(userId);

            if (!session) {
              subscriber.next({
                error: {
                  code: 'NO_SESSION',
                  message: 'No active session found',
                  timestamp: Date.now(),
                },
              });
              return;
            }

            if (session.sessionId !== msg.sessionId) {
              subscriber.next({
                error: {
                  code: 'SESSION_MISMATCH',
                  message: 'Session ID does not match active session',
                  timestamp: Date.now(),
                },
              });
              return;
            }

            if (
              session.isPaused &&
              msg.instructionType === StreamDataType.BREATH_PHASE
            ) {
              subscriber.next({
                error: {
                  code: 'SESSION_PAUSED',
                  message: 'Cannot accept breath_phase samples while paused',
                  timestamp: Date.now(),
                },
              });
              return;
            }

            const result = this.streamEngine.push(msg.sessionId, {
              timestamp: Number(msg.timestamp),
              moduleId: msg.moduleId,
              instructionType: msg.instructionType,
              data: msg.data,
            });

            subscriber.next({
              ack: {
                sessionId: msg.sessionId,
                receivedCount: result.totalReceived,
                droppedCount: result.droppedCount,
                maxSamplesPerSecond: this.streamEngine.maxSamplesPerSecond,
                timestamp: Date.now(),
              },
            });

            if (!result.accepted) {
              this.logger.warn(
                `Sample dropped for sessionId=${msg.sessionId} userId=${userId}: buffer cap reached`,
              );
            }
          } catch (err: unknown) {
            this.logger.error(
              `Unexpected error handling stream sample: userId=${userId}`,
              err,
            );
            subscriber.next({
              error: {
                code: 'INTERNAL_ERROR',
                message: 'An internal error occurred',
                timestamp: Date.now(),
              },
            });
          }
        },
        error: (err: unknown) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });

      subscriber.add(() => {
        this.activeStreamRegistry.deregister(userId, subscriber);
        sub.unsubscribe();
        this.logger.log(`Disconnected: userId=${userId}`);
      });
    });
  }
}
