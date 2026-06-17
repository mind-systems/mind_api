import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import { Observable } from 'rxjs';
import { extract, objectCarrier, runWithContext } from 'observe-js';

@Injectable()
export class GrpcTraceContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') {
      return next.handle();
    }

    const md = context.switchToRpc().getContext<Metadata>();
    const ctx = extract(
      objectCarrier({
        traceparent: md.get('traceparent')[0]?.toString() ?? '',
        tracestate: md.get('tracestate')[0]?.toString() ?? '',
      }),
    );

    if (!ctx) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      let sub: ReturnType<Observable<unknown>['subscribe']> | undefined;
      runWithContext(ctx, () => {
        sub = next.handle().subscribe(subscriber);
      });
      return () => sub?.unsubscribe();
    });
  }
}
