import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BreathSessionsController } from './breath-sessions.controller';
import { BreathSessionsGrpcController } from './breath-sessions.grpc.controller';
import { BreathSessionsService } from './breath-sessions.service';
import { BreathSessionSettingsService } from './breath-session-settings.service';
import { BreathSession } from './entities/breath-session.entity';
import { BreathSessionSettings } from './entities/breath-session-settings.entity';
import { AuthModule } from 'src/users/auth.module';
import { StatsModule } from 'src/stats/stats.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BreathSession, BreathSessionSettings]),
    AuthModule,
    StatsModule,
  ],
  controllers: [BreathSessionsController, BreathSessionsGrpcController],
  providers: [BreathSessionsService, BreathSessionSettingsService],
  exports: [BreathSessionsService],
})
export class BreathSessionsModule {}
