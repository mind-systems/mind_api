import {
  Controller,
  Logger,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { Payload, RpcException } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Observable, Subscriber } from 'rxjs';
import {
  ActivityEndCmd,
  ActivityPauseCmd,
  ActivityResumeCmd,
  ActivityStartCmd,
  ActivityStopCmd,
  ActivityType as ProtoActivityType,
  StateRequest,
  StateResponse,
  ModuleStateServiceControllerMethods,
  ActivityStatus,
} from '../../proto/generated/module_state';
import { ActivityType as InternalActivityType } from './enums/activity-type.enum';
import { ActivityEngine } from './services/activity-engine.service';
import { RateLimiterService } from './services/rate-limiter.service';
import { ActiveStreamRegistry } from './services/active-stream-registry.service';
import { ActivityIdempotencyStore } from './services/activity-idempotency.store';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';
import { GrpcMetadataValue } from '../grpc/decorators/grpc-metadata-value.decorator';
import { GRPC_MODULE_SESSION_ID_KEY } from '../grpc/grpc-auth.constants';
import { RealtimeConfig } from './constants/realtime-config';
import { WsErrorCode } from './constants/ws-error-codes';
import { AuthEvents } from '../users/events/auth.events';
import type { SessionRevokedPayload } from '../users/events/auth.events';
import { SessionEvents } from './events/session.events';
import type { JwtPayload } from '../users/interfaces/auth.interface';

function mapProtoActivityType(proto: ProtoActivityType): InternalActivityType {
  switch (proto) {
    case ProtoActivityType.BREATH:
      return InternalActivityType.BREATH;
    case ProtoActivityType.MEDITATION:
      return InternalActivityType.MEDITATION;
    case ProtoActivityType.ROOT:
      return InternalActivityType.ROOT;
    case ProtoActivityType.ACTIVITY_TYPE_UNSPECIFIED:
    case ProtoActivityType.UNRECOGNIZED:
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `Unsupported activity type: ${proto}`,
      });
    default: {
      // Compile-time exhaustiveness check: TypeScript errors here when a new
      // proto variant is added without a corresponding case above.
      const _exhaustive: never = proto;
      void _exhaustive;
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `Unsupported activity type: ${proto as number}`,
      });
    }
  }
}

/**
 * Total reverse mapper: internal → proto ActivityType.
 * Returns ACTIVITY_TYPE_UNSPECIFIED (0) for any type not explicitly mapped so
 * that optional/missing `activityType` fields on mocked session/state objects
 * produce a safe sentinel rather than throwing and replacing a valid frame with
 * INTERNAL_ERROR.
 */
function mapInternalActivityType(
  internal: InternalActivityType,
): ProtoActivityType {
  switch (internal) {
    case InternalActivityType.BREATH:
      return ProtoActivityType.BREATH;
    case InternalActivityType.MEDITATION:
      return ProtoActivityType.MEDITATION;
    case InternalActivityType.ROOT:
      return ProtoActivityType.ROOT;
    default: {
      // Compile-time exhaustiveness hint only — must not throw at runtime.
      const _exhaustive: never = internal;
      void _exhaustive;
      return ProtoActivityType.ACTIVITY_TYPE_UNSPECIFIED;
    }
  }
}

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
@ModuleStateServiceControllerMethods()
export class ModuleStateGrpcController {
  private readonly logger = new Logger(ModuleStateGrpcController.name);

  private readonly activityStartLimit: number;
  private readonly rateLimitWindowMs: number;
  private readonly idempotencyWindowMs: number;
  private readonly idempotency = new ActivityIdempotencyStore();

  constructor(
    private readonly activityEngine: ActivityEngine,
    private readonly rateLimiterService: RateLimiterService,
    private readonly activeStreamRegistry: ActiveStreamRegistry,
    configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.activityStartLimit = configService.get<number>(
      RealtimeConfig.RATE_LIMIT_ACTIVITY_START_PER_MIN,
      10,
    );
    this.rateLimitWindowMs = configService.get<number>(
      RealtimeConfig.RATE_LIMIT_WINDOW_MS,
      60_000,
    );
    this.idempotencyWindowMs = configService.get<number>(
      RealtimeConfig.IDEMPOTENCY_WINDOW_MS,
      10_000,
    );
  }

  trackActivity(
    @Payload() request: Observable<StateRequest>,
    @GrpcCurrentUser() user: JwtPayload | null,
    @GrpcMetadataValue(GRPC_MODULE_SESSION_ID_KEY) clientSessionId?: string,
  ): Observable<StateResponse> {
    return new Observable<StateResponse>((subscriber) => {
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

      let connectedAt = 0;

      const setup = async (): Promise<void> => {
        const result = await this.activityEngine.handleReconnect(
          userId,
          clientSessionId,
        );
        if (subscriber.closed) return;

        if (result !== null) {
          if ('abandoned' in result) {
            if (!clientSessionId) return;
            // ABANDONED: only clientSessionId is available; no session object to
            // derive activityType from — stamp ACTIVITY_TYPE_UNSPECIFIED (0).
            subscriber.next({
              sessionState: {
                moduleSessionId: clientSessionId,
                status: ActivityStatus.ABANDONED,
                activityType: ProtoActivityType.ACTIVITY_TYPE_UNSPECIFIED,
              },
            });
          } else {
            subscriber.next({
              sessionState: {
                moduleSessionId: result.id,
                status: ActivityStatus.RESUMED,
                isPaused:
                  this.activityEngine.getSession(userId, result.id)
                    ?.isPaused ?? false,
                activityType: mapInternalActivityType(result.activityType),
              },
            });
            this.logger.log(
              `Session resumed on reconnect: userId=${userId} sessionId=${result.id}`,
            );
          }
        }

        connectedAt = Date.now();

        if (subscriber.closed) return;
        await this.activityEngine.ensureRoot(userId);

        const cmdSub = request.subscribe({
          next: (msg: StateRequest) => {
            this.routeCommand(userId, msg, subscriber).catch((err: unknown) => {
              this.logger.error(
                `Unhandled error routing command: userId=${userId}`,
                err,
              );
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
        this.logger.log(
          `Disconnected: userId=${userId} connectedDurationMs=${connectedDurationMs}`,
        );

        (async () => {
          await this.activityEngine.handleTransportDisconnect(userId);
        })().catch((err: unknown) => {
          this.logger.error(
            `Failed to record disconnect: userId=${userId}`,
            err,
          );
        });

        this.rateLimiterService.evict(`activity-start:${userId}`);
        this.idempotency.evictUser(userId);
      });
    });
  }

  @OnEvent(AuthEvents.SESSION_REVOKED)
  async handleSessionRevoked(payload: SessionRevokedPayload): Promise<void> {
    const liveSessions = this.activityEngine.listLiveSessions(payload.userId);
    for (const session of liveSessions) {
      const { sessionId } = session;
      try {
        await this.activityEngine.stopActivity(payload.userId, sessionId);
      } catch (err: unknown) {
        this.logger.error(
          `Failed to stop activity on session revoke: userId=${payload.userId} sessionId=${sessionId}`,
          err,
        );
        this.eventEmitter.emit(SessionEvents.REVOKED, { sessionId });
      }
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
        await this.handleActivityEnd(userId, msg.activityEnd, subscriber);
      } else if (msg.activityStop !== undefined) {
        await this.handleActivityStop(userId, msg.activityStop, subscriber);
      } else if (msg.activityPause !== undefined) {
        await this.handleActivityPause(userId, msg.activityPause, subscriber);
      } else if (msg.activityResume !== undefined) {
        await this.handleActivityResume(userId, msg.activityResume, subscriber);
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
      this.logger.error(
        `Unexpected error handling command: userId=${userId}`,
        err,
      );
      subscriber.next({
        sessionError: {
          code: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
          timestamp: Date.now(),
        },
      });
    }
  }

  /**
   * Resolves which session a command targets.
   *
   * Priority:
   *  1. Explicit sessionId in the cmd → use it directly.
   *  2. Sole child (exactly one child) → use its sessionId.
   *  3. More than one child → emit AMBIGUOUS_SESSION and return { ok: false }.
   *  4. No children → return { ok: true, sessionId: undefined } so the engine
   *     returns null / throws no_active_session (preserves current no-session behaviour).
   */
  private resolveTargetSession(
    userId: string,
    explicitSessionId: string | undefined,
    subscriber: Subscriber<StateResponse>,
  ): { ok: true; sessionId: string | undefined } | { ok: false } {
    if (explicitSessionId !== undefined) {
      return { ok: true, sessionId: explicitSessionId };
    }

    const sole = this.activityEngine.getSoleChild(userId);
    if (sole) {
      return { ok: true, sessionId: sole.sessionId };
    }

    const children = this.activityEngine
      .listLiveSessions(userId)
      .filter((s) => s.activityType !== InternalActivityType.ROOT);

    if (children.length > 1) {
      subscriber.next({
        sessionError: {
          code: WsErrorCode.AMBIGUOUS_SESSION,
          message: 'Multiple active sessions — provide sessionId',
          timestamp: Date.now(),
        },
      });
      return { ok: false };
    }

    // 0 children — let the engine handle the no-session case
    return { ok: true, sessionId: undefined };
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

    // Resolve and validate the activity type before any dedup short-circuit so
    // the local variable is available for every emission (including cache hits).
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

    // Idempotency dedup: if clientActivityId is set and the window has not expired,
    // return the cached session id without calling startActivity/ensureRoot again.
    const clientActivityId = cmd.clientActivityId;
    if (clientActivityId !== undefined) {
      const idempotencyKey = `${userId}:${clientActivityId}`;
      const cachedId = this.idempotency.lookup(
        idempotencyKey,
        this.idempotencyWindowMs,
      );
      if (cachedId !== undefined) {
        subscriber.next({
          sessionState: {
            moduleSessionId: cachedId,
            status: ActivityStatus.ACTIVE,
            activityType: mapInternalActivityType(activityType),
          },
        });
        return;
      }
    }

    // Route ROOT starts through ensureRoot (idempotent by userId, sets
    // rootSessionId=null). Child types go through the regular startActivity path.
    const session =
      activityType === InternalActivityType.ROOT
        ? await this.activityEngine.ensureRoot(userId, cmd.clientTimestampMs)
        : await this.activityEngine.startActivity(userId, {
            activityType,
            activityRefId: cmd.refId,
            clientTimestampMs: cmd.clientTimestampMs,
          });

    // Record the new session id in the idempotency map so retries are deduped.
    if (clientActivityId !== undefined) {
      const idempotencyKey = `${userId}:${clientActivityId}`;
      this.idempotency.record(idempotencyKey, session.id);
    }

    subscriber.next({
      sessionState: {
        moduleSessionId: session.id,
        status: ActivityStatus.ACTIVE,
        activityType: mapInternalActivityType(activityType),
      },
    });
    this.logger.log(
      `Activity started: userId=${userId} sessionId=${session.id} activityType=${activityType}`,
    );
  }

  private async handleActivityEnd(
    userId: string,
    cmd: ActivityEndCmd,
    subscriber: Subscriber<StateResponse>,
  ): Promise<void> {
    const resolved = this.resolveTargetSession(
      userId,
      cmd.sessionId,
      subscriber,
    );
    if (!resolved.ok) return;
    // Double-defense: the engine already rejects root internally (endActivity
    // returns null for root), but this guard upgrades that silent no-op into an
    // explicit client-facing CANNOT_END_ROOT frame.
    const endRootId = this.activityEngine.getRootId(userId);
    if (resolved.sessionId !== undefined && resolved.sessionId === endRootId) {
      subscriber.next({
        sessionError: {
          code: 'CANNOT_END_ROOT',
          message: 'Root session cannot be ended by the client',
          timestamp: Date.now(),
        },
      });
      return;
    }
    const session = await this.activityEngine.endActivity(
      userId,
      resolved.sessionId,
      cmd.clientTimestampMs,
    );
    if (!session) return;
    subscriber.next({
      sessionState: {
        moduleSessionId: session.id,
        status: ActivityStatus.COMPLETED,
        activityType: mapInternalActivityType(session.activityType),
      },
    });
    this.logger.log(`Activity ended: userId=${userId} sessionId=${session.id}`);
  }

  private async handleActivityStop(
    userId: string,
    cmd: ActivityStopCmd,
    subscriber: Subscriber<StateResponse>,
  ): Promise<void> {
    const resolved = this.resolveTargetSession(
      userId,
      cmd.sessionId,
      subscriber,
    );
    if (!resolved.ok) return;
    // Double-defense: the engine already rejects root internally (stopActivity
    // returns null for root), but this guard upgrades that silent no-op into an
    // explicit client-facing CANNOT_END_ROOT frame.
    const stopRootId = this.activityEngine.getRootId(userId);
    if (resolved.sessionId !== undefined && resolved.sessionId === stopRootId) {
      subscriber.next({
        sessionError: {
          code: 'CANNOT_END_ROOT',
          message: 'Root session cannot be ended by the client',
          timestamp: Date.now(),
        },
      });
      return;
    }
    const session = await this.activityEngine.stopActivity(
      userId,
      resolved.sessionId,
    );
    if (!session) return;
    subscriber.next({
      sessionState: {
        moduleSessionId: session.id,
        status: ActivityStatus.INTERRUPTED,
        activityType: mapInternalActivityType(session.activityType),
      },
    });
    this.logger.log(
      `Activity stopped: userId=${userId} sessionId=${session.id}`,
    );
  }

  private async handleActivityPause(
    userId: string,
    cmd: ActivityPauseCmd,
    subscriber: Subscriber<StateResponse>,
  ): Promise<void> {
    const resolved = this.resolveTargetSession(
      userId,
      cmd.sessionId,
      subscriber,
    );
    if (!resolved.ok) return;
    try {
      const state = this.activityEngine.pauseActivity(
        userId,
        resolved.sessionId,
      );
      subscriber.next({
        sessionState: {
          moduleSessionId: state.sessionId,
          status: ActivityStatus.ACTIVE,
          isPaused: true,
          activityType: mapInternalActivityType(state.activityType),
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

  private async handleActivityResume(
    userId: string,
    cmd: ActivityResumeCmd,
    subscriber: Subscriber<StateResponse>,
  ): Promise<void> {
    const resolved = this.resolveTargetSession(
      userId,
      cmd.sessionId,
      subscriber,
    );
    if (!resolved.ok) return;
    try {
      const state = this.activityEngine.unpauseActivity(
        userId,
        resolved.sessionId,
      );
      subscriber.next({
        sessionState: {
          moduleSessionId: state.sessionId,
          status: ActivityStatus.ACTIVE,
          isPaused: false,
          activityType: mapInternalActivityType(state.activityType),
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
