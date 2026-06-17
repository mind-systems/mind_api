import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { GrpcMethod, Payload, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { ListMeditationPosesResponse } from '../../proto/generated/meditation_poses';
import { Empty } from '../../proto/generated/google/protobuf/empty';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import { toProtoMeditationPose } from '../grpc/grpc-mappers';
import { MeditationPosesService } from './meditation-poses.service';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class MeditationPosesGrpcController {
  constructor(
    private readonly meditationPosesService: MeditationPosesService,
  ) {}

  @GrpcMethod('MeditationPosesService', 'listPoses')
  async listPoses(
    @Payload() _req: Empty,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Promise<ListMeditationPosesResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing user context',
      });
    }
    const poses = await this.meditationPosesService.listAll();
    return { poses: poses.map(toProtoMeditationPose) };
  }
}
