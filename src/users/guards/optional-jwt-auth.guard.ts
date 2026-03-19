import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload, RequestWithUser } from '../interfaces/auth.interface';
import { SessionService } from '../service/session.service';
import { PersonalAccessTokenService } from '../service/personal-access-token.service';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
    private readonly personalAccessTokenService: PersonalAccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(request);

    if (!token) {
      return true;
    }

    try {
      if (token.startsWith('pat_')) {
        const payload =
          await this.personalAccessTokenService.validateToken(token);
        if (payload) {
          request.user = payload;
        }
        return true;
      }

      const payload = await this.jwtService.verifyAsync(token);
      const isValid = await this.sessionService.isValid(token);
      if (isValid) {
        request.user = payload as JwtPayload;
      }
    } catch {
      // Invalid token or missing session — treat as anonymous
    }

    return true;
  }

  private extractToken(request: RequestWithUser): string | undefined {
    const authHeader = request.headers?.authorization as string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return undefined;
  }
}
