import { Controller, UseFilters } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import {
  AuthResponse,
  AuthServiceController,
  AuthServiceControllerMethods,
  CreateTokenRequest,
  CreateTokenResponse,
  DeleteTokenRequest,
  DeleteTokenResponse,
  GoogleAuthRequest,
  ListTokensRequest,
  ListTokensResponse,
  LogoutRequest,
  LogoutResponse,
  SendCodeRequest,
  SendCodeResponse,
  VerifyCodeRequest,
} from '../../proto/generated/auth';
import { AuthService } from './service/auth.service';
import { AuthCodeService } from './service/auth-code.service';
import { PersonalAccessTokenService } from './service/personal-access-token.service';
import { SessionService } from './service/session.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { UserRole } from './interfaces/user-role.enum';
import type { AuthResponseDto } from './dto/auth-response.dto';
import type { JwtPayload } from './interfaces/auth.interface';
// TODO: uncomment when 1.4 is merged
// import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
// import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';

function toProtoUserRole(role: UserRole): number {
  switch (role) {
    case UserRole.ADMIN:
      return 1;
    case UserRole.USER:
    default:
      return 0;
  }
}

function toProtoAuthResponse(dto: AuthResponseDto): AuthResponse {
  return {
    accessToken: dto.accessToken,
    user: {
      id: dto.user.id,
      email: dto.user.email,
      name: dto.user.name,
      role: toProtoUserRole(dto.user.role),
      language: dto.user.language,
    },
  };
}

@Controller()
@AuthServiceControllerMethods()
@UseFilters(GrpcExceptionFilter)
export class AuthGrpcController implements AuthServiceController {
  constructor(
    private readonly authCodeService: AuthCodeService,
    private readonly authService: AuthService,
    private readonly personalAccessTokenService: PersonalAccessTokenService,
    private readonly sessionService: SessionService,
  ) {}

  async sendCode(request: SendCodeRequest): Promise<SendCodeResponse> {
    await this.authCodeService.sendCode(request.email, request.locale);
    return { message: 'If this email is registered, a code has been sent.' };
  }

  async verifyCode(request: VerifyCodeRequest): Promise<AuthResponse> {
    const dto = await this.authCodeService.verifyCode(
      request.email,
      request.code,
      request.language,
    );
    return toProtoAuthResponse(dto);
  }

  async googleAuth(request: GoogleAuthRequest): Promise<AuthResponse> {
    const dto = await this.authService.signInWithGoogle(
      request.serverAuthCode,
      request.language,
      request.redirectUri,
    );
    return toProtoAuthResponse(dto);
  }

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async logout(
    _request: LogoutRequest,
    metadata?: Metadata,
    // @GrpcCurrentUser() _user?: JwtPayload, // TODO: uncomment when 1.4 is merged
  ): Promise<LogoutResponse> {
    const raw = metadata?.get('authorization')[0]?.toString();
    const token = raw?.startsWith('Bearer ') ? raw.slice(7) : raw;
    if (!token) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing authorization metadata',
      });
    }
    await this.sessionService.revoke(token);
    return { message: 'Logout successful.' };
  }

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async createToken(
    request: CreateTokenRequest,
    // @GrpcCurrentUser() // TODO: uncomment when 1.4 is merged
    user?: JwtPayload,
  ): Promise<CreateTokenResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const result = await this.personalAccessTokenService.create(
      user.sub,
      request.name,
    );
    return {
      token: result.token,
      id: result.id,
      name: result.name,
      createdAt: result.createdAt.toISOString(),
    };
  }

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async listTokens(
    _request: ListTokensRequest,
    // @GrpcCurrentUser() // TODO: uncomment when 1.4 is merged
    user?: JwtPayload,
  ): Promise<ListTokensResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const tokens = await this.personalAccessTokenService.list(user.sub);
    return {
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : undefined,
      })),
    };
  }

  // @UseInterceptors(GrpcAuthInterceptor) // TODO: uncomment when 1.4 is merged
  async deleteToken(
    request: DeleteTokenRequest,
    // @GrpcCurrentUser() // TODO: uncomment when 1.4 is merged
    user?: JwtPayload,
  ): Promise<DeleteTokenResponse> {
    if (!user) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Authentication required',
      });
    }
    await this.personalAccessTokenService.revoke(request.id, user.sub);
    return { message: 'Token revoked.' };
  }
}
