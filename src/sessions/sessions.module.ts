import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../users/auth.module';
// NOTE: ModuleSession is semantically owned by RealtimeModule (write path).
// SessionsModule is a read-only consumer for the web dashboard.
// Registering the same entity in TypeOrmModule.forFeature in both modules is intentional —
// it gives this module its own scoped repository without touching RealtimeModule.
import { ModuleSession } from '../realtime/entities/module-session.entity';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ModuleSession]),
    AuthModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
