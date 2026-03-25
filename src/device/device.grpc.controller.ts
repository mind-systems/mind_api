import { Controller, UseFilters } from '@nestjs/common';
import {
  PingRequest,
  PingResponse,
  DeviceServiceController,
  DeviceServiceControllerMethods,
} from '../../proto/generated/device';
import { DeviceService } from './device.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';

@Controller()
@DeviceServiceControllerMethods()
@UseFilters(GrpcExceptionFilter)
export class DeviceGrpcController implements DeviceServiceController {
  constructor(private readonly deviceService: DeviceService) {}

  async ping(request: PingRequest): Promise<PingResponse> {
    await this.deviceService.ping(request);
    return {};
  }
}
