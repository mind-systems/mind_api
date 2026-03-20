import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../users/auth.module';
import { StateStore } from './state-store';
import { WsAuthGuard } from './guards/ws-auth.guard';
import { WsAuthMiddleware } from './middleware/ws-auth.middleware';
import { LiveGateway } from './gateways/live.gateway';
import { PresenceService } from './services/presence.service';
import { ActivityEngine } from './services/activity-engine.service';
import { GraceTimerManager } from './services/grace-timer.service';
import { StartupRecoveryService } from './services/startup-recovery.service';
import { StreamEngine } from './services/stream-engine.service';
import { TelemetryGateway } from './gateways/telemetry.gateway';
import { RateLimiterService } from './services/rate-limiter.service';
import { WsRateLimitGuard } from './guards/ws-rate-limit.guard';
import { ObservabilityService } from './services/observability.service';
import { SyncNotifierService } from './services/sync-notifier.service';
import { LiveSession } from './entities/live-session.entity';
import { SessionStreamSample } from './entities/session-stream-sample.entity';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([LiveSession, SessionStreamSample]),
  ],
  providers: [
    StateStore,
    WsAuthMiddleware,
    WsAuthGuard,
    WsRateLimitGuard,
    RateLimiterService,
    LiveGateway,
    TelemetryGateway,
    PresenceService,
    ActivityEngine,
    GraceTimerManager,
    StartupRecoveryService,
    StreamEngine,
    ObservabilityService,
    SyncNotifierService,
  ],
  exports: [StateStore, PresenceService],
})
export class RealtimeModule {}
