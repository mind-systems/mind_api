import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../users/auth.module';
import { NfbCalibrationRecord } from './entities/nfb-calibration-record.entity';
import { NfbCalibrationGrpcController } from './nfb-calibration.grpc.controller';
import { NfbCalibrationRestController } from './nfb-calibration.rest.controller';
import { NfbCalibrationService } from './nfb-calibration.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([NfbCalibrationRecord])],
  controllers: [NfbCalibrationGrpcController, NfbCalibrationRestController],
  providers: [NfbCalibrationService],
})
export class NfbCalibrationModule {}
