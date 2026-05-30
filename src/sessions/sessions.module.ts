import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../users/auth.module';
// NOTE: ModuleSession, BioSessionSample, and SessionStreamSample are semantically owned by
// RealtimeModule (write path). SessionsModule is a read-only consumer for the web dashboard.
// Registering the same entities in TypeOrmModule.forFeature in both modules is intentional —
// it gives SessionsService its own scoped repositories without crossing module boundaries.
// BioSessionSample and SessionStreamSample are read-only here; RealtimeModule owns writes.
import { ModuleSession } from '../realtime/entities/module-session.entity';
import { BioSessionSample } from '../realtime/entities/bio-session-sample.entity';
import { SessionStreamSample } from '../realtime/entities/session-stream-sample.entity';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ModuleSession,
      BioSessionSample,
      SessionStreamSample,
    ]),
    AuthModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
