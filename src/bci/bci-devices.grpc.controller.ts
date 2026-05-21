import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { GrpcMethod, Payload, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  ListBciDevicesResponse,
  RegisterBciDeviceRequest,
  DeleteBciDeviceRequest,
  BciDevice as BciDeviceProto,
} from '../../proto/generated/bci_devices';
import { Empty } from '../../proto/generated/google/protobuf/empty';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { toProtoBciDevice } from '../grpc/grpc-mappers';
import { BciDeviceService } from './bci-device.service';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class BciDevicesGrpcController {
  constructor(private readonly bciDeviceService: BciDeviceService) {}

  @GrpcMethod('BciDevicesService', 'list')
  async list(
    @Payload() _request: Empty,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<ListBciDevicesResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    const devices = await this.bciDeviceService.listForUser(user.sub);
    return { devices: devices.map(toProtoBciDevice) };
  }

  @GrpcMethod('BciDevicesService', 'register')
  async register(
    @Payload() request: RegisterBciDeviceRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<BciDeviceProto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    const device = await this.bciDeviceService.register(
      user.sub,
      request.serial,
    );
    return toProtoBciDevice(device);
  }

  @GrpcMethod('BciDevicesService', 'delete')
  async delete(
    @Payload() request: DeleteBciDeviceRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<Empty> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    await this.bciDeviceService.delete(user.sub, request.id);
    return {};
  }
}
