import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { GrpcMethod, Payload, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  RecordNfbCalibrationRequest,
  ListNfbCalibrationsRequest,
  ListNfbCalibrationsResponse,
  NfbCalibrationRecord as NfbCalibrationRecordProto,
} from '../../proto/generated/nfb_calibration';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { toProtoNfbCalibrationRecord } from '../grpc/grpc-mappers';
import { NfbCalibrationService } from './nfb-calibration.service';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class NfbCalibrationGrpcController {
  constructor(private readonly nfbCalibrationService: NfbCalibrationService) {}

  @GrpcMethod('NfbCalibrationService', 'record')
  async record(
    @Payload() request: RecordNfbCalibrationRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<NfbCalibrationRecordProto> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    const entity = await this.nfbCalibrationService.record(user.sub, request);
    return toProtoNfbCalibrationRecord(entity);
  }

  @GrpcMethod('NfbCalibrationService', 'list')
  async list(
    @Payload() request: ListNfbCalibrationsRequest,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<ListNfbCalibrationsResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    const [records] = await this.nfbCalibrationService.list(
      user.sub,
      request.deviceSerial,
      request.limit,
      0,
    );
    return { records: records.map(toProtoNfbCalibrationRecord) };
  }
}
