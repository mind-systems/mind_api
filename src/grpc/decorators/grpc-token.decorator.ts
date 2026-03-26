import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import { GRPC_TOKEN_KEY } from '../grpc-auth.constants';

export const GrpcToken = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | null => {
    const metadata = ctx.switchToRpc().getContext<Metadata>();
    return (metadata as any)[GRPC_TOKEN_KEY] as string | null;
  },
);
