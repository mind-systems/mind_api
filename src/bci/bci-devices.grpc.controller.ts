import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { BciDeviceService } from './bci-device.service';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class BciDevicesGrpcController {
  constructor(private readonly bciDeviceService: BciDeviceService) {}
}
