import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../users/auth.module';
import { UserStats } from './entities/user-stats.entity';
import { StatsService } from './stats.service';
import { StatsWorker } from './stats.worker';
import { StatsGrpcController } from './stats.grpc.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserStats]), AuthModule],
  providers: [StatsService, StatsWorker],
  controllers: [StatsGrpcController],
  exports: [StatsService],
})
export class StatsModule {}
