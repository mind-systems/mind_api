import { Controller, UseFilters } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import { JwtService } from '@nestjs/jwt';
import {
  UpdateProfileRequest,
  UserServiceController,
  UserServiceControllerMethods,
} from '../../proto/generated/users';
import type { UserDto } from '../../proto/generated/auth';
import { UserService } from './service/user.service';
import { SessionService } from './service/session.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { SUPPORTED_LOCALES } from '../config/locales';
import { toProtoUserDto } from '../grpc/grpc-mappers';
import type { JwtPayload } from './interfaces/auth.interface';
// TODO: uncomment when 1.4 is merged
// import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
// import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';

@Controller()
@UserServiceControllerMethods()
@UseFilters(GrpcExceptionFilter)
export class UsersGrpcController implements UserServiceController {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
  ) {}

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async updateProfile(
    request: UpdateProfileRequest,
    metadata?: Metadata,
    // @GrpcCurrentUser() _user?: JwtPayload, // TODO: uncomment when 1.4 is merged
  ): Promise<UserDto> {
    const raw = metadata?.get('authorization')[0]?.toString();
    const token = raw?.startsWith('Bearer ') ? raw.slice(7) : raw;
    if (!token) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing authorization metadata',
      });
    }

    let userId: string;
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      userId = payload.sub;
    } catch {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Invalid authorization token',
      });
    }

    const isValid = await this.sessionService.isValid(token);
    if (!isValid) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Session not found or revoked',
      });
    }

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

    const result = await this.userService.updateProfile(userId, updateDto);
    return toProtoUserDto(result);
  }
}
