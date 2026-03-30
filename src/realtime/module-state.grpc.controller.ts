import { Controller, Logger, UseFilters, UseInterceptors } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { status as GrpcStatus, Metadata } from '@grpc/grpc-js';
import { Observable, Subscriber } from 'rxjs';
import {
  ActivityStartCmd,
  ActivityType as ProtoActivityType,
  StateRequest,
  StateResponse,
  ModuleStateServiceController,
  ModuleStateServiceControllerMethods,
  ActivityStatus,
} from '../../proto/generated/module_state';
import { ActivityType as InternalActivityType } from './enums/activity-type.enum';
import { ActivityEngine } from './services/activity-engine.service';
import { RateLimiterService } from './services/rate-limiter.service';
import { ActiveStreamRegistry } from './services/active-stream-registry.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GRPC_USER_KEY } from '../grpc/grpc-auth.constants';
import { RealtimeConfig } from './constants/realtime-config';
import { AuthEvents } from '../users/events/auth.events';
import type { SessionRevokedPayload } from '../users/events/auth.events';
import type { JwtPayload } from '../users/interfaces/auth.interface';

function mapProtoActivityType(proto: ProtoActivityType): InternalActivityType {
  if (proto === ProtoActivityType.BREATH) {
    return InternalActivityType.BREATH;
  }
  throw new RpcException({
    code: GrpcStatus.INVALID_ARGUMENT,
    message: `Unsupported activity type: ${proto}`,
  });
}

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
@ModuleStateServiceControllerMethods()
export class ModuleStateGrpcController implements ModuleStateServiceController {
  private readonly logger = new Logger(ModuleStateGrpcController.name);

  private readonly activityStartLimit: number;
  private readonly rateLimitWindowMs: number;

  constructor(
    private readonly activityEngine: ActivityEngine,
    private readonly rateLimiterService: RateLimiterService,
    private readonly activeStreamRegistry: ActiveStreamRegistry,
    configService: ConfigService,
  ) {
    this.activityStartLimit = configService.get<number>(
      RealtimeConfig.RATE_LIMIT_ACTIVITY_START_PER_MIN,
      10,
    );
    this.rateLimitWindowMs = configService.get<number>(
      RealtimeConfig.RATE_LIMIT_WINDOW_MS,
      60_000,
    );
  }

  trackActivity(request: Observable<StateRequest>, metadata?: Metadata): Observable<StateResponse> {
    return new Observable<StateResponse>((subscriber) => {
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

      this.activeStreamRegistry.register(userId, subscriber);

      let connectedAt = 0;

      const setup = async (): Promise<void> => {
        const session = await this.activityEngine.handleReconnect(userId);
        if (subscriber.closed) return;

        if (session) {
          subscriber.next({
            sessionState: {
              moduleSessionId: session.id,
              status: ActivityStatus.RESUMED,
              isPaused: false,
            },
          });
          this.logger.log(`Session resumed on reconnect: userId=${userId} sessionId=${session.id}`);
        }

        connectedAt = Date.now();

        const cmdSub = request.subscribe({
          next: (msg: StateRequest) => {
            this.routeCommand(userId, msg, subscriber).catch((err: unknown) => {
              this.logger.error(`Unhandled error routing command: userId=${userId}`, err);
              subscriber.next({
                sessionError: {
                  code: 'INTERNAL_ERROR',
                  message: 'An internal error occurred',
                  timestamp: Date.now(),
                },
              });
            });
          },
          error: (err: unknown) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });

        subscriber.add(() => cmdSub.unsubscribe());
      };

      setup().catch((err: unknown) => {
        this.logger.error(`Stream setup failed: userId=${userId}`, err);
        subscriber.next({
          sessionError: {
            code: 'INTERNAL_ERROR',
            message: 'Stream setup failed',
            timestamp: Date.now(),
          },
        });
        subscriber.complete();
      });

      // Teardown
      subscriber.add(() => {
        this.activeStreamRegistry.deregister(userId, subscriber);
        const connectedDurationMs = connectedAt ? Date.now() - connectedAt : 0;
        this.logger.log(`Disconnected: userId=${userId} connectedDurationMs=${connectedDurationMs}`);

        (async () => {
          await this.activityEngine.handleTransportDisconnect(userId);
        })().catch((err: unknown) => {
          this.logger.error(`Failed to record disconnect: userId=${userId}`, err);
        });

        this.rateLimiterService.evict(`activity-start:${userId}`);
      });
    });
  }

  @OnEvent(AuthEvents.SESSION_REVOKED)
  async handleSessionRevoked(payload: SessionRevokedPayload): Promise<void> {
    try {
      await this.activityEngine.stopActivity(payload.userId);
    } catch (err: unknown) {
      this.logger.error(`Failed to stop activity on session revoke: userId=${payload.userId}`, err);
    }
    this.activeStreamRegistry.closeAll(payload.userId);
  }

  private async routeCommand(
    userId: string,
    msg: StateRequest,
    subscriber: Subscriber<StateResponse>,
  ): Promise<void> {
    try {
      if (msg.activityStart !== undefined) {
        await this.handleActivityStart(userId, msg.activityStart, subscriber);
      } else if (msg.activityEnd !== undefined) {
        await this.handleActivityEnd(userId, subscriber);
      } else if (msg.activityStop !== undefined) {
        await this.handleActivityStop(userId, subscriber);
      } else if (msg.activityPause !== undefined) {
        this.handleActivityPause(userId, subscriber);
      } else if (msg.activityResume !== undefined) {
        this.handleActivityResume(userId, subscriber);
      } else {
        subscriber.next({
          sessionError: {
            code: 'INVALID_COMMAND',
            message: 'Empty StateRequest — no command set',
            timestamp: Date.now(),
          },
        });
      }
    } catch (err: unknown) {
      this.logger.error(`Unexpected error handling command: userId=${userId}`, err);
      subscriber.next({
        sessionError: {
          code: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
          timestamp: Date.now(),
        },
      });
    }
  }

  private async handleActivityStart(
    userId: string,
    cmd: ActivityStartCmd,
    subscriber: Subscriber<StateResponse>,
  ): Promise<void> {
    const allowed = this.rateLimiterService.consume(
      `activity-start:${userId}`,
      this.activityStartLimit,
      this.rateLimitWindowMs,
    );
    if (!allowed) {
      subscriber.next({
        sessionError: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many activity:start requests',
          timestamp: Date.now(),
        },
      });
      return;
    }

    const existing = this.activityEngine.getActiveSession(userId);
    if (existing) {
      subscriber.next({
        sessionState: {
          moduleSessionId: existing.sessionId,
          status: ActivityStatus.ACTIVE,
        },
      });
      return;
    }

    let activityType: InternalActivityType;
    try {
      activityType = mapProtoActivityType(cmd.activityType);
    } catch {
      subscriber.next({
        sessionError: {
          code: 'INVALID_ACTIVITY_TYPE',
          message: `Unsupported activity type: ${cmd.activityType}`,
          timestamp: Date.now(),
        },
      });
      return;
    }

    const session = await this.activityEngine.startActivity(userId, {
      activityType,
      activityRefId: cmd.refId,
    });
    subscriber.next({
      sessionState: {
        moduleSessionId: session.id,
        status: ActivityStatus.ACTIVE,
      },
    });
    this.logger.log(`Activity started: userId=${userId} sessionId=${session.id}`);
  }

  private async handleActivityEnd(
    userId: string,
    subscriber: Subscriber<StateResponse>,
  ): Promise<void> {
    const session = await this.activityEngine.endActivity(userId);
    if (!session) return;
    subscriber.next({
      sessionState: {
        moduleSessionId: session.id,
        status: ActivityStatus.COMPLETED,
      },
    });
    this.logger.log(`Activity ended: userId=${userId} sessionId=${session.id}`);
  }

  private async handleActivityStop(
    userId: string,
    subscriber: Subscriber<StateResponse>,
  ): Promise<void> {
    const session = await this.activityEngine.stopActivity(userId);
    if (!session) return;
    subscriber.next({
      sessionState: {
        moduleSessionId: session.id,
        status: ActivityStatus.INTERRUPTED,
      },
    });
    this.logger.log(`Activity stopped: userId=${userId} sessionId=${session.id}`);
  }

  private handleActivityPause(userId: string, subscriber: Subscriber<StateResponse>): void {
    try {
      const state = this.activityEngine.pauseActivity(userId);
      subscriber.next({
        sessionState: {
          moduleSessionId: state.sessionId,
          status: ActivityStatus.ACTIVE,
          isPaused: true,
        },
      });
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : 'NO_ACTIVE_SESSION';
      subscriber.next({
        sessionError: {
          code,
          message: `Cannot pause: ${code}`,
          timestamp: Date.now(),
        },
      });
    }
  }

  private handleActivityResume(userId: string, subscriber: Subscriber<StateResponse>): void {
    try {
      const state = this.activityEngine.unpauseActivity(userId);
      subscriber.next({
        sessionState: {
          moduleSessionId: state.sessionId,
          status: ActivityStatus.ACTIVE,
          isPaused: false,
        },
      });
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : 'NO_ACTIVE_SESSION';
      subscriber.next({
        sessionError: {
          code,
          message: `Cannot resume: ${code}`,
          timestamp: Date.now(),
        },
      });
    }
  }

}
