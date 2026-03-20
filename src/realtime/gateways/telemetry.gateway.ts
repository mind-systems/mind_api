import { Logger, UseFilters, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsAuthGuard } from '../guards/ws-auth.guard';
import { WsAuthMiddleware } from '../middleware/ws-auth.middleware';
import { WsPayloadSizeGuard } from '../guards/ws-payload-size.guard';
import { WsRateLimitGuard } from '../guards/ws-rate-limit.guard';
import { ActivityEngine } from '../services/activity-engine.service';
import { StreamEngine } from '../services/stream-engine.service';
import { RateLimiterService } from '../services/rate-limiter.service';
import { DataStreamDto } from '../dto/data-stream.dto';
import { DATA_ACK, DATA_STREAM } from '../events/telemetry.events';
import { SESSION_ERROR } from '../events/live.events';
import type { AuthenticatedSocket } from '../interfaces/authenticated-socket.interface';
import { WsExceptionFilter } from '../filters/ws-exception.filter';
import { WsErrorCode } from '../constants/ws-error-codes';
import { StreamDataType } from '../constants/stream-data-types';

// cors: true — mobile-only clients (Flutter) don't enforce CORS.
// Tighten to a specific origin allowlist if a web client is added.
@WebSocketGateway({ namespace: '/telemetry', cors: true })
@UseFilters(WsExceptionFilter)
@UseGuards(WsAuthGuard, WsPayloadSizeGuard, WsRateLimitGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class TelemetryGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TelemetryGateway.name);

  constructor(
    private readonly activityEngine: ActivityEngine,
    private readonly streamEngine: StreamEngine,
    private readonly rateLimiterService: RateLimiterService,
    private readonly wsAuthMiddleware: WsAuthMiddleware,
  ) {}

  afterInit(server: Server): void {
    server.use(this.wsAuthMiddleware.middleware());
    this.logger.log('[Telemetry] WsAuthMiddleware registered');
  }

  handleConnection(client: Socket): void {
    const userId = (client as AuthenticatedSocket).data.userId;
    if (!userId) {
      // Should not happen — WsAuthMiddleware rejects unauthenticated sockets
      // before handleConnection fires. This is a safety net only.
      this.logger.warn(
        `[Telemetry] handleConnection: no userId — socketId=${client.id}, disconnecting`,
      );
      client.disconnect(true);
      return;
    }
    this.logger.log(`[Telemetry] Connected — userId=${userId} socketId=${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.rateLimiterService.evict(client.id);
  }

  @SubscribeMessage(DATA_STREAM)
  handleDataStream(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: DataStreamDto,
  ): void {
    const userId = (client as AuthenticatedSocket).data.userId;
    if (!userId) return;

    const session = this.activityEngine.getActiveSession(userId);

    if (!session) {
      this.logger.warn(`data:stream rejected — NO_SESSION for userId=${userId} dtoSessionId=${dto.sessionId}`);
      client.emit(SESSION_ERROR, {
        code: WsErrorCode.NO_SESSION,
        message: 'No active session found',
        timestamp: Date.now(),
      });
      return;
    }

    if (session.sessionId !== dto.sessionId) {
      this.logger.warn(`data:stream rejected — SESSION_MISMATCH userId=${userId} activeSessionId=${session.sessionId} dtoSessionId=${dto.sessionId}`);
      client.emit(SESSION_ERROR, {
        code: WsErrorCode.SESSION_MISMATCH,
        message: 'Session ID does not match active session',
        timestamp: Date.now(),
      });
      return;
    }

    if (session.isPaused && dto.data?.dataType === StreamDataType.BREATH_PHASE) {
      client.emit(DATA_ACK, { error: WsErrorCode.SESSION_PAUSED });
      return;
    }

    const result = this.streamEngine.push(session.sessionId, {
      timestamp: dto.timestamp,
      data: dto.data,
    });

    client.emit(DATA_ACK, {
      sessionId: session.sessionId,
      receivedCount: result.totalReceived,
      maxSamplesPerSecond: this.streamEngine.maxSamplesPerSecond,
      timestamp: Date.now(),
      droppedCount: result.droppedCount > 0 ? result.droppedCount : undefined,
    });

    if (!result.accepted) {
      this.logger.warn(
        `Sample dropped for sessionId=${session.sessionId}: buffer cap reached`,
      );
    }
  }
}
