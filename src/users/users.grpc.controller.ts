import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  UpdateProfileRequest,
  UserServiceController,
  UserServiceControllerMethods,
} from '../../proto/generated/users';
import type { UserDto } from '../../proto/generated/auth';
import { UserService } from './service/user.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { SUPPORTED_LOCALES } from '../config/locales';
import { toProtoUserDto } from '../grpc/grpc-mappers';
import type { JwtPayload } from './interfaces/auth.interface';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';

@Controller()
@UserServiceControllerMethods()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
export class UsersGrpcController implements UserServiceController {
  constructor(
    private readonly userService: UserService,
  ) {}

  async updateProfile(
    request: UpdateProfileRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<UserDto> {
    if (request.name !== undefined && request.name.length < 1) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: 'name must be at least 1 character',
      });
    }

    if (
      request.language !== undefined &&
      !(SUPPORTED_LOCALES as readonly string[]).includes(request.language)
    ) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: 'language must be one of: en, ru',
      });
    }

    const updateDto: { name?: string; language?: string } = {};
    if (request.name !== undefined) updateDto.name = request.name;
    if (request.language !== undefined) updateDto.language = request.language;

    const result = await this.userService.updateProfile(user!.sub, updateDto);
    return toProtoUserDto(result);
  }
}
