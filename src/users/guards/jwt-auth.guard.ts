import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload, RequestWithUser } from '../interfaces/auth.interface';
import { SessionService } from '../service/session.service';
import { PersonalAccessTokenService } from '../service/personal-access-token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
    private readonly personalAccessTokenService: PersonalAccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('JWT token not found');
    }

    if (token.startsWith('pat_')) {
      const payload =
        await this.personalAccessTokenService.validateToken(token);
      if (!payload) {
        throw new UnauthorizedException('Invalid personal access token');
      }
      request.user = payload;
      return true;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      const isValid = await this.sessionService.isValid(token);
      if (!isValid) {
        throw new UnauthorizedException('Session not found or revoked');
      }
      request.user = payload as JwtPayload;
      return true;
    } catch (error: any) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired JWT token');
    }
  }

  public extractToken(request: RequestWithUser): string | undefined {
    const authHeader = request.headers?.authorization as string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return undefined;
  }
}
