import { SetMetadata } from '@nestjs/common';
import { GRPC_OPTIONAL_AUTH_KEY } from '../grpc-auth.constants';

export const GrpcOptionalAuth = () => SetMetadata(GRPC_OPTIONAL_AUTH_KEY, true);
