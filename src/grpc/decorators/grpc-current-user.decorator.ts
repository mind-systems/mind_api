import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import { GRPC_USER_KEY } from '../grpc-auth.constants';
import type { JwtPayload } from '../../users/interfaces/auth.interface';

export const GrpcCurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): JwtPayload | null => {
    const metadata = ctx.switchToRpc().getContext<Metadata>();
    return (metadata as any)[GRPC_USER_KEY] as JwtPayload | null;
  },
);
