import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
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
import { toProtoUserDto } from '../grpc/grpc-mappers';
import type { AuthResponseDto } from './dto/auth-response.dto';
import type { JwtPayload } from './interfaces/auth.interface';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';
import { GrpcToken } from '../grpc/decorators/grpc-token.decorator';

function toProtoAuthResponse(dto: AuthResponseDto): AuthResponse {
  return {
    accessToken: dto.accessToken,
    user: toProtoUserDto(dto.user),
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

  @UseInterceptors(GrpcAuthInterceptor)
  async logout(
    _request: LogoutRequest,
    @GrpcToken() token?: string,
  ): Promise<LogoutResponse> {
    await this.sessionService.revoke(token!);
    return { message: 'Logout successful.' };
  }

  @UseInterceptors(GrpcAuthInterceptor)
  async createToken(
    request: CreateTokenRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<CreateTokenResponse> {
    const result = await this.personalAccessTokenService.create(
      user!.sub,
      request.name,
    );
    return {
      token: result.token,
      id: result.id,
      name: result.name,
      createdAt: result.createdAt.toISOString(),
    };
  }

  @UseInterceptors(GrpcAuthInterceptor)
  async listTokens(
    _request: ListTokensRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<ListTokensResponse> {
    const tokens = await this.personalAccessTokenService.list(user!.sub);
    return {
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : undefined,
      })),
    };
  }

  @UseInterceptors(GrpcAuthInterceptor)
  async deleteToken(
    request: DeleteTokenRequest,
    @GrpcCurrentUser() user?: JwtPayload,
  ): Promise<DeleteTokenResponse> {
    await this.personalAccessTokenService.revoke(request.id, user!.sub);
    return { message: 'Token revoked.' };
  }
}
