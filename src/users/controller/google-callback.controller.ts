import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

@Controller('auth')
export class GoogleCallbackController {
  private readonly logger = new Logger(GoogleCallbackController.name);

  constructor(private readonly configService: ConfigService) {}

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const baseUrl = this.configService.getOrThrow<string>('APP_BASE_URL');
    const callbackPath = '/auth/google/callback';
    if (error || !code) {
      this.logger.warn(
        `Google OAuth callback error: ${error ?? 'missing code'}`,
      );
      return res.redirect(
        `${baseUrl}${callbackPath}?googleError=${encodeURIComponent(error ?? 'missing_code')}`,
      );
    }
    this.logger.log('Google OAuth callback: relaying code to app');
    return res.redirect(
      `${baseUrl}${callbackPath}?googleCode=${encodeURIComponent(code)}`,
    );
  }
}
