import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { throwError } from 'rxjs';

function httpToGrpcStatus(httpStatus: number): number {
  switch (httpStatus) {
    case 400:
      return GrpcStatus.INVALID_ARGUMENT;
    case 401:
      return GrpcStatus.UNAUTHENTICATED;
    case 403:
      return GrpcStatus.PERMISSION_DENIED;
    case 404:
      return GrpcStatus.NOT_FOUND;
    case 409:
      return GrpcStatus.ALREADY_EXISTS;
    case 429:
      return GrpcStatus.RESOURCE_EXHAUSTED;
    default:
      return GrpcStatus.INTERNAL;
  }
}

@Catch(HttpException)
export class GrpcExceptionFilter implements ExceptionFilter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  catch(exception: HttpException, _host: ArgumentsHost) {
    const httpStatus = exception.getStatus();
    const response = exception.getResponse();

    const message =
      typeof response === 'string'
        ? response
        : ((response as { message?: string | string[] }).message ??
          exception.message);

    const code = httpToGrpcStatus(httpStatus);

    return throwError(() => new RpcException({ code, message }));
  }
}
