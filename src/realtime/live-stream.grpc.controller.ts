import { Controller, Logger, UseFilters, UseInterceptors } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { status as GrpcStatus, Metadata } from '@grpc/grpc-js';
import { Observable, Subscriber } from 'rxjs';
import {
  ActivityStartCmd,
  ActivityType as ProtoActivityType,
  LiveRequest,
  LiveResponse,
  LiveServiceController,
  LiveServiceControllerMethods,
  PresenceCmd,
  PresenceState,
  SessionStatus,
} from '../../proto/generated/live';
import { ActivityType as InternalActivityType } from './enums/activity-type.enum';
import { ActivityEngine } from './services/activity-engine.service';
import { PresenceService } from './services/presence.service';
import { RateLimiterService } from './services/rate-limiter.service';
import { ActiveStreamRegistry } from './services/active-stream-registry.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GRPC_USER_KEY } from '../grpc/grpc-auth.constants';
import { RealtimeConfig } from './constants/realtime-config';
import { AuthEvents } from '../users/events/auth.events';
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
@LiveServiceControllerMethods()
export class LiveStreamGrpcController implements LiveServiceController {
  private readonly logger = new Logger(LiveStreamGrpcController.name);

  private readonly activityStartLimit: number;
  private readonly rateLimitWindowMs: number;

  constructor(
    private readonly activityEngine: ActivityEngine,
    private readonly presenceService: PresenceService,
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

  liveSession(request: Observable<LiveRequest>, metadata?: Metadata): Observable<LiveResponse> {
    return new Observable<LiveResponse>((subscriber) => {
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

      const setup = async (): Promise<void> => {
        const session = await this.activityEngine.handleReconnect(userId);
        if (session) {
          subscriber.next({
            sessionState: {
              liveSessionId: session.id,
              status: SessionStatus.RESUMED,
              isPaused: false,
            },
          });
          this.logger.log(`Session resumed on reconnect: userId=${userId} sessionId=${session.id}`);
        }

        this.presenceService.online(userId, userId);

        const cmdSub = request.subscribe({
          next: (msg: LiveRequest) => {
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
      });

      // Teardown
      subscriber.add(() => {
        this.activeStreamRegistry.deregister(userId, subscriber);
        const connectedAt = this.presenceService.get(userId)?.connectedAt;
        const connectedDurationMs = connectedAt ? Date.now() - connectedAt.getTime() : 0;
        this.logger.log(`Disconnected: userId=${userId} connectedDurationMs=${connectedDurationMs}`);

        (async () => {
          this.presenceService.offline(userId);
          await this.activityEngine.handleTransportDisconnect(userId);
        })().catch((err: unknown) => {
          this.logger.error(`Failed to record disconnect: userId=${userId}`, err);
        });

        this.rateLimiterService.evict(`activity-start:${userId}`);
      });
    });
  }

  @OnEvent(AuthEvents.SESSION_REVOKED)
  async handleSessionRevoked(payload: { userId: string }): Promise<void> {
    await this.activityEngine.stopActivity(payload.userId);
    this.activeStreamRegistry.closeAll(payload.userId);
  }

  private async routeCommand(
    userId: string,
    msg: LiveRequest,
    subscriber: Subscriber<LiveResponse>,
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
      } else if (msg.presence !== undefined) {
        this.handlePresence(userId, msg.presence, subscriber);
      } else {
        subscriber.next({
          sessionError: {
            code: 'INVALID_COMMAND',
            message: 'Empty LiveRequest — no command set',
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
    subscriber: Subscriber<LiveResponse>,
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
          liveSessionId: existing.sessionId,
          status: SessionStatus.ACTIVE,
        },
      });
      return;
    }

    const activityType = mapProtoActivityType(cmd.activityType);
    const session = await this.activityEngine.startActivity(userId, {
      activityType,
      activityRefId: cmd.refId,
    });
    subscriber.next({
      sessionState: {
        liveSessionId: session.id,
        status: SessionStatus.ACTIVE,
      },
    });
    this.logger.log(`Activity started: userId=${userId} sessionId=${session.id}`);
  }

  private async handleActivityEnd(
    userId: string,
    subscriber: Subscriber<LiveResponse>,
  ): Promise<void> {
    const session = await this.activityEngine.endActivity(userId);
    if (!session) return;
    subscriber.next({
      sessionState: {
        liveSessionId: session.id,
        status: SessionStatus.COMPLETED,
      },
    });
    this.logger.log(`Activity ended: userId=${userId} sessionId=${session.id}`);
  }

  private async handleActivityStop(
    userId: string,
    subscriber: Subscriber<LiveResponse>,
  ): Promise<void> {
    const session = await this.activityEngine.stopActivity(userId);
    if (!session) return;
    subscriber.next({
      sessionState: {
        liveSessionId: session.id,
        status: SessionStatus.INTERRUPTED,
      },
    });
    this.logger.log(`Activity stopped: userId=${userId} sessionId=${session.id}`);
  }

  private handleActivityPause(userId: string, subscriber: Subscriber<LiveResponse>): void {
    try {
      const state = this.activityEngine.pauseActivity(userId);
      subscriber.next({
        sessionState: {
          liveSessionId: state.sessionId,
          status: SessionStatus.ACTIVE,
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

  private handleActivityResume(userId: string, subscriber: Subscriber<LiveResponse>): void {
    try {
      const state = this.activityEngine.unpauseActivity(userId);
      subscriber.next({
        sessionState: {
          liveSessionId: state.sessionId,
          status: SessionStatus.ACTIVE,
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

  private handlePresence(
    userId: string,
    cmd: PresenceCmd,
    subscriber: Subscriber<LiveResponse>,
  ): void {
    if (cmd.state === PresenceState.FOREGROUND) {
      this.presenceService.foreground(userId);
    } else if (cmd.state === PresenceState.BACKGROUND) {
      this.presenceService.background(userId);
    } else {
      subscriber.next({
        sessionError: {
          code: 'INVALID_PRESENCE_STATE',
          message: 'PresenceState must be FOREGROUND or BACKGROUND',
          timestamp: Date.now(),
        },
      });
    }
  }
}
