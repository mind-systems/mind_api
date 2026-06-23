import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';

export const GrpcMetadataValue = createParamDecorator(
  (key: string, ctx: ExecutionContext): string | undefined => {
    const metadata = ctx.switchToRpc().getContext<Metadata>();
    return metadata.get(key)[0]?.toString();
  },
);
