import { Logger, UseFilters, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsAuthGuard } from '../guards/ws-auth.guard';
import { WsAuthMiddleware } from '../middleware/ws-auth.middleware';
import { WsPayloadSizeGuard } from '../guards/ws-payload-size.guard';
import { WsRateLimitGuard } from '../guards/ws-rate-limit.guard';
import { StateStore } from '../state-store';
import { PresenceService } from '../services/presence.service';
import { ActivityEngine } from '../services/activity-engine.service';
import { GraceTimerManager } from '../services/grace-timer.service';
import {
  ACTIVITY_END,
  ACTIVITY_PAUSE,
  ACTIVITY_RESUME,
  ACTIVITY_START,
  ACTIVITY_STOP,
  PRESENCE_BACKGROUND,
  PRESENCE_FOREGROUND,
  SESSION_ERROR,
  SESSION_STATE,
} from '../events/live.events';
import { RateLimiterService } from '../services/rate-limiter.service';
import type { AuthenticatedSocket } from '../interfaces/authenticated-socket.interface';
import { ActivityStartDto } from '../dto/activity-start.dto';
import { WsExceptionFilter } from '../filters/ws-exception.filter';
import { SessionStatus } from '../enums/session-status.enum';
import { WsErrorCode } from '../constants/ws-error-codes';
import { RealtimeConfig } from '../constants/realtime-config';

// cors: true — mobile-only clients (Flutter) don't enforce CORS.
// Tighten to a specific origin allowlist if a web client is added.
@WebSocketGateway({ namespace: '/live', cors: true })
@UseFilters(WsExceptionFilter)
@UseGuards(WsAuthGuard, WsPayloadSizeGuard, WsRateLimitGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class LiveGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveGateway.name);

  @WebSocketServer()
  server: Server;

  private readonly connectedAt = new Map<string, number>();
  private readonly activityStartLimit: number;
  private readonly rateLimitWindowMs: number;

  constructor(
    private readonly stateStore: StateStore,
    private readonly presenceService: PresenceService,
    private readonly activityEngine: ActivityEngine,
    private readonly graceTimerManager: GraceTimerManager,
    private readonly rateLimiterService: RateLimiterService,
    private readonly wsAuthMiddleware: WsAuthMiddleware,
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

  afterInit(server: Server): void {
    server.use(this.wsAuthMiddleware.middleware());
    this.logger.log('[Live] WsAuthMiddleware registered');
  }

  handleConnection(client: Socket): void {
    const socket = client as AuthenticatedSocket;
    const userId = socket.data.userId;

    if (!userId) {
      // Should not happen — WsAuthMiddleware rejects unauthenticated sockets
      // before handleConnection fires. This is a safety net only.
      this.logger.warn(`[Live] handleConnection: no userId — socketId=${client.id}, disconnecting`);
      client.disconnect(true);
      return;
    }

    const existing = this.stateStore.socketMap.get(userId);
    if (existing) {
      this.logger.log(`Evicting previous connection for user ${userId}`);
      existing.disconnect(true);
    }

    this.stateStore.socketMap.set(userId, socket);
    this.connectedAt.set(client.id, Date.now());
    this.presenceService.online(userId, client.id);
    this.logger.log(`Connected: userId=${userId} socketId=${client.id}`);

    // Reconnect: if a disconnected session is pending in activityMap, resume it
    if (this.stateStore.activityMap.has(userId)) {
      this.graceTimerManager.cancelTimer(userId);
      this.activityEngine
        .resumeActivity(userId)
        .then((session) => {
          if (session) {
            client.emit(SESSION_STATE, {
              liveSessionId: session.id,
              status: SessionStatus.RESUMED,
              isPaused: false,
            });
            this.logger.log(
              `Session resumed: userId=${userId} sessionId=${session.id}`,
            );
          }
        })
        .catch((err: unknown) => {
          this.logger.error(`Failed to resume session: userId=${userId}`, err);
        });
    }
  }

  handleDisconnect(client: Socket): void {
    const socket = client as AuthenticatedSocket;
    const userId = socket.data.userId;
    if (!userId) return;

    const stored = this.stateStore.socketMap.get(userId);
    if (stored?.id === client.id) {
      this.stateStore.socketMap.delete(userId);
      this.presenceService.offline(userId);
      this.activityEngine
        .onDisconnect(userId)
        .then(() => {
          // Start grace timer only if the session is still in activityMap
          if (this.stateStore.activityMap.has(userId)) {
            this.graceTimerManager.startTimer(userId, () => {
              this.logger.log(`Grace expired: userId=${userId} — abandoning session`);
              this.activityEngine
                .abandonActivity(userId)
                .catch((err: unknown) => {
                  this.logger.error(
                    `Failed to abandon session after grace: userId=${userId}`,
                    err,
                  );
                });
            });
          }
        })
        .catch((err: unknown) => {
          this.logger.error(
            `Failed to record disconnect: userId=${userId}`,
            err,
          );
        });
    }

    const connectedDurationMs = Date.now() - (this.connectedAt.get(client.id) ?? Date.now());
    this.connectedAt.delete(client.id);
    this.rateLimiterService.evict(client.id);
    this.logger.log(
      `Disconnected: userId=${userId} socketId=${client.id} connectedDurationMs=${connectedDurationMs}`,
    );
  }

  @SubscribeMessage(ACTIVITY_START)
  async handleActivityStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ActivityStartDto,
  ): Promise<void> {
    const userId = (client as AuthenticatedSocket).data.userId;
    if (!userId) return;

    const allowed = this.rateLimiterService.consume(
      `activity-start:${userId}`,
      this.activityStartLimit,
      this.rateLimitWindowMs,
    );
    if (!allowed) {
      client.emit(SESSION_ERROR, {
        code: WsErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'Too many activity:start requests',
        timestamp: Date.now(),
      });
      return;
    }

    const existing = this.activityEngine.getActiveSession(userId);
    if (existing) {
      client.emit(SESSION_STATE, {
        liveSessionId: existing.sessionId,
        status: SessionStatus.ACTIVE,
      });
      return;
    }

    const session = await this.activityEngine.startActivity(userId, dto);
    client.emit(SESSION_STATE, { liveSessionId: session.id, status: SessionStatus.ACTIVE });
    this.logger.log(
      `Activity started: userId=${userId} sessionId=${session.id}`,
    );
  }

  @SubscribeMessage(ACTIVITY_END)
  async handleActivityEnd(@ConnectedSocket() client: Socket): Promise<void> {
    const userId = (client as AuthenticatedSocket).data.userId;
    if (!userId) return;

    const session = await this.activityEngine.endActivity(userId);
    if (!session) return;

    client.emit(SESSION_STATE, { liveSessionId: session.id, status: SessionStatus.COMPLETED });
    this.logger.log(`Activity ended: userId=${userId} sessionId=${session.id}`);
  }

  @SubscribeMessage(ACTIVITY_STOP)
  async handleActivityStop(@ConnectedSocket() client: Socket): Promise<void> {
    const userId = (client as AuthenticatedSocket).data.userId;
    if (!userId) return;

    const session = await this.activityEngine.stopActivity(userId);
    if (!session) return;

    client.emit(SESSION_STATE, { liveSessionId: session.id, status: SessionStatus.INTERRUPTED });
    this.logger.log(`Activity stopped: userId=${userId} sessionId=${session.id}`);
  }

  @SubscribeMessage(ACTIVITY_PAUSE)
  handleActivityPause(@ConnectedSocket() client: Socket): void {
    const userId = (client as AuthenticatedSocket).data.userId;
    if (!userId) return;

    try {
      const state = this.activityEngine.pauseActivity(userId);
      client.emit(SESSION_STATE, {
        liveSessionId: state.sessionId,
        status: SessionStatus.ACTIVE,
        isPaused: true,
      });
    } catch (err: unknown) {
      const code =
        err instanceof Error ? err.message : WsErrorCode.NO_ACTIVE_SESSION;
      client.emit(SESSION_ERROR, {
        code,
        message: `Cannot pause: ${code}`,
        timestamp: Date.now(),
      });
    }
  }

  @SubscribeMessage(ACTIVITY_RESUME)
  handleActivityResume(@ConnectedSocket() client: Socket): void {
    const userId = (client as AuthenticatedSocket).data.userId;
    if (!userId) return;

    try {
      const state = this.activityEngine.unpauseActivity(userId);
      client.emit(SESSION_STATE, {
        liveSessionId: state.sessionId,
        status: SessionStatus.ACTIVE,
        isPaused: false,
      });
    } catch (err: unknown) {
      const code =
        err instanceof Error ? err.message : WsErrorCode.NO_ACTIVE_SESSION;
      client.emit(SESSION_ERROR, {
        code,
        message: `Cannot resume: ${code}`,
        timestamp: Date.now(),
      });
    }
  }

  // Fire-and-forget — no ack returned. Clients treat presence events as best-effort.
  @SubscribeMessage(PRESENCE_BACKGROUND)
  handleBackground(@ConnectedSocket() client: Socket): void {
    const userId = (client as AuthenticatedSocket).data.userId;
    if (!userId) return;
    this.presenceService.background(userId);
    this.logger.log(`Background: userId=${userId}`);
  }

  @SubscribeMessage(PRESENCE_FOREGROUND)
  handleForeground(@ConnectedSocket() client: Socket): void {
    const userId = (client as AuthenticatedSocket).data.userId;
    if (!userId) return;
    this.presenceService.foreground(userId);
    this.logger.log(`Foreground: userId=${userId}`);
  }
}
