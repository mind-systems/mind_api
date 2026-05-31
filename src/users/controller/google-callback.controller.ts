import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthService } from '../service/auth.service';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { GoogleCodeExchangeDto } from '../dto/google-code-exchange.dto';

@Controller('auth')
export class GoogleCallbackController {
  private readonly logger = new Logger(GoogleCallbackController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {}

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const baseUrl = this.configService.getOrThrow<string>('APP_BASE_URL');
    const callbackPath = '/auth/google/callback';
    if (error || !code) {
      this.logger.warn(
        `Google OAuth callback error: ${error ?? 'missing code'}`,
      );
      const params = new URLSearchParams({
        googleError: error ?? 'missing_code',
        ...(state ? { state } : {}),
      });
      return res.redirect(`${baseUrl}${callbackPath}?${params.toString()}`);
    }
    this.logger.log('Google OAuth callback: relaying code to app');
    const params = new URLSearchParams({
      googleCode: code,
      ...(state ? { state } : {}),
    });
    return res.redirect(`${baseUrl}${callbackPath}?${params.toString()}`);
  }

  @Get('google')
  startGoogleOAuth(
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): void {
    const clientId = this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const redirectUri =
      this.configService.getOrThrow<string>('WEB_REDIRECT_URI');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      ...(state ? { state } : {}),
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.redirect(302, url);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  async exchangeGoogleCode(
    @Body() dto: GoogleCodeExchangeDto,
  ): Promise<AuthResponseDto> {
    const allowedRedirectUri =
      this.configService.getOrThrow<string>('WEB_REDIRECT_URI');
    if (dto.redirectUri !== allowedRedirectUri) {
      throw new BadRequestException('Invalid redirectUri');
    }
    return this.authService.signInWithGoogle(
      dto.code,
      dto.language,
      dto.redirectUri,
    );
  }
}
