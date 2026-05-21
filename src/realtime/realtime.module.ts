import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../users/auth.module';
import { StateStore } from './state-store';
import { ActivityEngine } from './services/activity-engine.service';
import { ActivitySessionStore } from './services/activity-session-store.service';
import { StartupRecoveryService } from './services/startup-recovery.service';
import { StreamEngine } from './services/stream-engine.service';
import { RateLimiterService } from './services/rate-limiter.service';
import { ObservabilityService } from './services/observability.service';
import { ModuleSession } from './entities/module-session.entity';
import { SessionStreamSample } from './entities/session-stream-sample.entity';
import { SyncStreamGrpcController } from './sync-stream.grpc.controller';
import { SyncStreamService } from './services/sync-stream.service';
import { ActiveStreamRegistry } from './services/active-stream-registry.service';
import { ModuleStateGrpcController } from './module-state.grpc.controller';
import { ModuleInstructionStreamGrpcController } from './module-instruction-stream.grpc.controller';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([ModuleSession, SessionStreamSample]),
  ],
  controllers: [
    SyncStreamGrpcController,
    ModuleStateGrpcController,
    ModuleInstructionStreamGrpcController,
  ],
  providers: [
    StateStore,
    ActivitySessionStore,
    RateLimiterService,
    ActivityEngine,
    StartupRecoveryService,
    StreamEngine,
    ObservabilityService,
    SyncStreamService,
    ActiveStreamRegistry,
  ],
  exports: [StateStore, ActivitySessionStore],
})
export class RealtimeModule {}
