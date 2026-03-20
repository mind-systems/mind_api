import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getDatabaseConfig } from '../database.config';
import { AuthModule } from './users/auth.module';
import { UserModule } from './users/user.module';
import { HealthController } from './health.controller';
import { BreathSessionsModule } from './breath-sessions/breath-sessions.module';
import { DeviceModule } from './device/device.module';
import { RealtimeModule } from './realtime/realtime.module';
import { StatsModule } from './stats/stats.module';
import { ChangelogModule } from './changelog/changelog.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // Конфиг-PostgresSQL
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getDatabaseConfig,
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    AuthModule,
    UserModule,
    BreathSessionsModule,
    DeviceModule,
    RealtimeModule,
    StatsModule,
    ChangelogModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
