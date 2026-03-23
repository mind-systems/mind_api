import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './service/auth.service';
import { AuthCodeService } from './service/auth-code.service';
import { PersonalAccessTokenService } from './service/personal-access-token.service';
import { UserResponseDto } from './dto/auth-response.dto';
import { SendCodeDto } from './dto/send-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { CreateTokenDto } from './dto/create-token.dto';
import {
  CreateTokenResponseDto,
  TokenResponseDto,
} from './dto/token-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { Response } from 'express';
import type { JwtPayload, RequestWithUser } from './interfaces/auth.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly authCodeService: AuthCodeService,
    private readonly personalAccessTokenService: PersonalAccessTokenService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({ summary: 'Send authentication code to email' })
  @ApiResponse({
    status: 200,
    description: 'If this email is registered, a code has been sent.',
  })
  @ApiResponse({ status: 429, description: 'Too Many Requests' })
  @Post('send-code')
  @HttpCode(HttpStatus.OK)
  async sendCode(@Body() sendCodeDto: SendCodeDto) {
    await this.authCodeService.sendCode(sendCodeDto.email, sendCodeDto.locale);
    return { message: 'If this email is registered, a code has been sent.' };
  }

  @ApiOperation({ summary: 'Verify authentication code and get JWT' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or expired code' })
  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  async verifyCode(
    @Body() verifyCodeDto: VerifyCodeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponseDto> {
    const authResponse = await this.authCodeService.verifyCode(
      verifyCodeDto.email,
      verifyCodeDto.code,
      verifyCodeDto.language,
    );
    res.setHeader('Authorization', `Bearer ${authResponse.accessToken}`);
    return authResponse.user;
  }

  @ApiOperation({
    summary: 'Sign in with Google (server authorization code flow)',
  })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired Google authorization code',
  })
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleAuth(
    @Body() dto: GoogleAuthDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponseDto> {
    const authResponse = await this.authService.signInWithGoogle(
      dto.serverAuthCode,
      dto.language,
      dto.redirectUri,
    );
    res.setHeader('Authorization', `Bearer ${authResponse.accessToken}`);
    return authResponse.user;
  }

  @ApiOperation({ summary: 'Google OAuth callback relay — redirects back to the mobile app' })
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const baseUrl = this.configService.getOrThrow<string>('APP_BASE_URL');
    const callbackPath = '/auth/google/callback';
    if (error || !code) {
      this.logger.warn(`Google OAuth callback error: ${error ?? 'missing code'}`);
      return res.redirect(`${baseUrl}${callbackPath}?googleError=${encodeURIComponent(error ?? 'missing_code')}`);
    }
    this.logger.log('Google OAuth callback: relaying code to app');
    return res.redirect(`${baseUrl}${callbackPath}?googleCode=${encodeURIComponent(code)}`);
  }

  @ApiOperation({ summary: 'Logout' })
  @ApiResponse({ status: 200, description: 'Logout successful' })
  @ApiBearerAuth()
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@Request() req: RequestWithUser) {
    await this.authService.logout(req);
    return { message: 'Logout successful.' };
  }

  @ApiOperation({ summary: 'Create a personal access token' })
  @ApiResponse({ status: 201, type: CreateTokenResponseDto })
  @ApiBearerAuth()
  @Post('tokens')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createToken(
    @Body() dto: CreateTokenDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CreateTokenResponseDto> {
    return this.personalAccessTokenService.create(user.sub, dto.name);
  }

  @ApiOperation({ summary: 'List personal access tokens' })
  @ApiResponse({ status: 200, type: [TokenResponseDto] })
  @ApiBearerAuth()
  @Get('tokens')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async listTokens(
    @CurrentUser() user: JwtPayload,
  ): Promise<TokenResponseDto[]> {
    return this.personalAccessTokenService.list(user.sub);
  }

  @ApiOperation({ summary: 'Revoke a personal access token' })
  @ApiResponse({ status: 200, description: 'Token revoked.' })
  @ApiResponse({ status: 404, description: 'Token not found' })
  @ApiBearerAuth()
  @Delete('tokens/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async revokeToken(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ message: string }> {
    await this.personalAccessTokenService.revoke(id, user.sub);
    return { message: 'Token revoked.' };
  }
}
