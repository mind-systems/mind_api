import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../users/auth.module';
import { StateStore } from './state-store';
import { PresenceService } from './services/presence.service';
import { ActivityEngine } from './services/activity-engine.service';
import { ActivitySessionStore } from './services/activity-session-store.service';
import { StartupRecoveryService } from './services/startup-recovery.service';
import { StreamEngine } from './services/stream-engine.service';
import { RateLimiterService } from './services/rate-limiter.service';
import { ObservabilityService } from './services/observability.service';
import { LiveSession } from './entities/live-session.entity';
import { SessionStreamSample } from './entities/session-stream-sample.entity';
import { SyncStreamGrpcController } from './sync-stream.grpc.controller';
import { SyncStreamService } from './services/sync-stream.service';
import { ActiveStreamRegistry } from './services/active-stream-registry.service';
import { ModuleSessionGrpcController } from './module-session.grpc.controller';
import { ModuleStreamGrpcController } from './module-stream.grpc.controller';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([LiveSession, SessionStreamSample]),
  ],
  controllers: [SyncStreamGrpcController, ModuleSessionGrpcController, ModuleStreamGrpcController],
  providers: [
    StateStore,
    ActivitySessionStore,
    RateLimiterService,
    PresenceService,
    ActivityEngine,
    StartupRecoveryService,
    StreamEngine,
    ObservabilityService,
    SyncStreamService,
    ActiveStreamRegistry,
  ],
  exports: [StateStore, PresenceService, ActivitySessionStore],
})
export class RealtimeModule {}
