import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../users/auth.module';
import { MeditationPose } from './entities/meditation-pose.entity';
import { MeditationPosesGrpcController } from './meditation-poses.grpc.controller';
import { MeditationPosesService } from './meditation-poses.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([MeditationPose])],
  controllers: [MeditationPosesGrpcController],
  providers: [MeditationPosesService],
})
export class MeditationPosesModule {}
