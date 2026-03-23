import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { GoogleProfile } from '../interfaces/google-profile.interface';

@Injectable()
export class GoogleTokenService {
  private readonly logger = new Logger(GoogleTokenService.name);
  private readonly client: OAuth2Client;
  private readonly clientId: string;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.getOrThrow<string>(
      'GOOGLE_CLIENT_SECRET',
    );
    this.client = new OAuth2Client(this.clientId, clientSecret);
  }

  async exchangeCodeForProfile(
    serverAuthCode: string,
    redirectUri?: string,
  ): Promise<GoogleProfile> {
    const isBrowserFlow = !!redirectUri;

    if (isBrowserFlow) {
      this.logger.log(`Google auth: browser flow, redirectUri=${redirectUri}`);
    }

    let idToken: string;
    try {
      const response = isBrowserFlow
        ? await this.client.getToken({
            code: serverAuthCode,
            redirect_uri: redirectUri,
          })
        : await this.client.getToken(serverAuthCode);
      if (!response.tokens.id_token) {
        this.logger.error(
          'Google token response missing id_token — possible misconfiguration (wrong client type or missing scopes)',
        );
        throw new UnauthorizedException(
          'Invalid or expired Google authorization code',
        );
      }
      idToken = response.tokens.id_token;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.warn(`Token exchange failed: ${(error as Error).message}`);
      throw new UnauthorizedException(
        'Invalid or expired Google authorization code',
      );
    }

    let googleId: string;
    let email: string;
    let name: string;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new Error('Empty id_token payload');
      }
      if (!payload.email_verified) {
        throw new Error('Google account email is not verified');
      }
      if (!payload.email) {
        throw new Error('Google account has no email');
      }

      googleId = payload.sub;
      email = payload.email;
      name = payload.name ?? email.split('@')[0];
    } catch (error) {
      this.logger.warn(
        `id_token verification failed: ${(error as Error).message}`,
      );
      throw new UnauthorizedException('Google token verification failed');
    }

    this.logger.log(`Google auth: googleId=${googleId}`);
    return { googleId, email, name };
  }
}
