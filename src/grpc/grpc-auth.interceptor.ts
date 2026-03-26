import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RpcException } from '@nestjs/microservices';
import { JwtService } from '@nestjs/jwt';
import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import { Observable } from 'rxjs';
import { SessionService } from '../users/service/session.service';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import {
  GRPC_OPTIONAL_AUTH_KEY,
  GRPC_TOKEN_KEY,
  GRPC_USER_KEY,
} from './grpc-auth.constants';

@Injectable()
export class GrpcAuthInterceptor implements NestInterceptor {
  constructor(
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const isOptionalAuth = this.reflector.get<boolean>(
      GRPC_OPTIONAL_AUTH_KEY,
      context.getHandler(),
    );

    const metadata: Metadata = context.switchToRpc().getContext<Metadata>();

    const raw = metadata.get('authorization')[0]?.toString();
    const token = raw?.startsWith('Bearer ') ? raw.slice(7) : raw;

    if (!token) {
      if (isOptionalAuth) {
        // Symbol keys: invisible to Metadata iteration, won't collide with string keys
        (metadata as any)[GRPC_USER_KEY] = null;
        (metadata as any)[GRPC_TOKEN_KEY] = null;
        return next.handle();
      }
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: 'Missing authorization metadata',
      });
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
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

    // Symbol keys: invisible to Metadata iteration, won't collide with string keys
    (metadata as any)[GRPC_USER_KEY] = payload;
    (metadata as any)[GRPC_TOKEN_KEY] = token;

    return next.handle();
  }
}
