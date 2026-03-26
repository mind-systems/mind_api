import { Controller, Logger, UseFilters, UseInterceptors } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus, Metadata } from '@grpc/grpc-js';
import { Observable } from 'rxjs';
import {
  TelemetryData,
  TelemetryResponse,
  TelemetryServiceController,
  TelemetryServiceControllerMethods,
} from '../../proto/generated/telemetry';
import { StreamEngine } from './services/stream-engine.service';
import { ActivityEngine } from './services/activity-engine.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GRPC_USER_KEY } from '../grpc/grpc-auth.constants';
import { StreamDataType } from './constants/stream-data-types';
import type { JwtPayload } from '../users/interfaces/auth.interface';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
@TelemetryServiceControllerMethods()
export class TelemetryStreamGrpcController implements TelemetryServiceController {
  private readonly logger = new Logger(TelemetryStreamGrpcController.name);

  constructor(
    private readonly streamEngine: StreamEngine,
    private readonly activityEngine: ActivityEngine,
  ) {}

  streamTelemetry(
    request: Observable<TelemetryData>,
    metadata?: Metadata,
  ): Observable<TelemetryResponse> {
    return new Observable<TelemetryResponse>((subscriber) => {
      const user = metadata
        ? ((metadata as any)[GRPC_USER_KEY] as JwtPayload | null)
        : null;

      if (!user) {
        subscriber.error(
          new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: 'Missing user context' }),
        );
        return;
      }

      const userId = user.sub;

      const sub = request.subscribe({
        next: (msg: TelemetryData) => {
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

            if (session.isPaused && msg.instructionType === StreamDataType.BREATH_PHASE) {
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
              timestamp: msg.timestamp,
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
              `Unexpected error handling telemetry sample: userId=${userId}`,
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
        sub.unsubscribe();
        this.logger.log(`Disconnected: userId=${userId}`);
      });
    });
  }
}
