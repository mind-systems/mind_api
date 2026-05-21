import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BciDevice } from './entities/bci-device.entity';
import { BciDevicesGrpcController } from './bci-devices.grpc.controller';
import { BciDeviceService } from './bci-device.service';

@Module({
  imports: [TypeOrmModule.forFeature([BciDevice])],
  controllers: [BciDevicesGrpcController],
  providers: [BciDeviceService],
})
export class BciModule {}
