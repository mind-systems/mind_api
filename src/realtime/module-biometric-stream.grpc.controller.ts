import {
  Controller,
  Logger,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { Payload, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Observable, Subscriber } from 'rxjs';
import {
  BioSampleBatch,
  BioStreamResponse,
  ModuleBiometricStreamServiceControllerMethods,
} from '../../proto/generated/module_biometric_stream';
import { BiometricStreamEngine } from './services/biometric-stream-engine.service';
import { ActivityEngine } from './services/activity-engine.service';
import { ActiveStreamRegistry } from './services/active-stream-registry.service';
import { GrpcExceptionFilter } from '../grpc/grpc-exception.filter';
import { GrpcAuthInterceptor } from '../grpc/grpc-auth.interceptor';
import { GrpcCurrentUser } from '../grpc/decorators/grpc-current-user.decorator';
import { BioSampleInternal } from './interfaces/bio-session-buffer.interface';
import type { JwtPayload } from '../users/interfaces/auth.interface';

@Controller()
@UseFilters(GrpcExceptionFilter)
@UseInterceptors(GrpcAuthInterceptor)
@ModuleBiometricStreamServiceControllerMethods()
export class ModuleBiometricStreamGrpcController {
  private readonly logger = new Logger(
    ModuleBiometricStreamGrpcController.name,
  );

  constructor(
    private readonly streamEngine: BiometricStreamEngine,
    private readonly activityEngine: ActivityEngine,
    private readonly activeStreamRegistry: ActiveStreamRegistry,
  ) {}

  streamData(
    @Payload() request: Observable<BioSampleBatch>,
    @GrpcCurrentUser() user: JwtPayload | null,
  ): Observable<BioStreamResponse> {
    return new Observable<BioStreamResponse>((subscriber) => {
      if (!user) {
        subscriber.error(
          new RpcException({
            code: GrpcStatus.UNAUTHENTICATED,
            message: 'Missing user context',
          }),
        );
        return;
      }

      const userId = user.sub;

      this.activeStreamRegistry.register(userId, subscriber);

      subscriber.next({
        ready: {
          maxSamplesPerSecond: this.streamEngine.maxSamplesPerSecond,
          timestamp: Date.now(),
        },
      });

      const sub = request.subscribe({
        next: (batch: BioSampleBatch) => {
          this.handleBatch(userId, batch, subscriber);
        },
        error: (err: unknown) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });

      subscriber.add(() => {
        this.activeStreamRegistry.deregister(userId, subscriber);
        sub.unsubscribe();
        this.logger.log(`Disconnected: userId=${userId}`);
      });
    });
  }

  private handleBatch(
    userId: string,
    batch: BioSampleBatch,
    subscriber: Subscriber<BioStreamResponse>,
  ): void {
    try {
      const emitError = (code: string, message: string) =>
        subscriber.next({ error: { code, message, timestamp: Date.now() } });

      // Step 1: empty batch
      if (batch.samples.length === 0) {
        emitError('INVALID_ARGUMENT', 'Empty batch');
        return;
      }

      // Step 2: missing sessionId (must precede step 3 so all-empty sessionIds surface the right error)
      if (batch.samples[0].sessionId === '') {
        emitError('INVALID_ARGUMENT', 'Missing sessionId');
        return;
      }

      // Step 3: inconsistent sessionId across samples
      if (
        batch.samples.some((s) => s.sessionId !== batch.samples[0].sessionId)
      ) {
        emitError('INVALID_ARGUMENT', 'Inconsistent sessionId in batch');
        return;
      }

      // Step 4: missing sampleType on any sample
      if (batch.samples.some((s) => s.sampleType === '')) {
        emitError('INVALID_ARGUMENT', 'Missing sampleType');
        return;
      }

      // Step 5: no active session for this user
      const session = this.activityEngine.getActiveSession(userId);
      if (!session) {
        emitError('NO_SESSION', 'No active session found');
        return;
      }

      // Step 6: session ID mismatch
      if (session.sessionId !== batch.samples[0].sessionId) {
        emitError(
          'SESSION_MISMATCH',
          'Session ID does not match active session',
        );
        return;
      }

      // Happy path
      const batchSessionId = batch.samples[0].sessionId;

      const mapped: BioSampleInternal[] = batch.samples.map((s) => ({
        timestamp: Number(s.timestamp),
        sampleType: s.sampleType,
        data: s.data,
      }));

      const result = this.streamEngine.pushBatch(batchSessionId, mapped);

      subscriber.next({
        ack: {
          sessionId: batchSessionId,
          receivedCount: result.totalReceived,
          droppedCount: result.totalDropped,
          maxSamplesPerSecond: this.streamEngine.maxSamplesPerSecond,
          timestamp: Date.now(),
        },
      });

      if (result.droppedCount > 0) {
        this.logger.warn(
          `Sample(s) dropped for sessionId=${batchSessionId} userId=${userId}: buffer cap reached`,
        );
      }
    } catch (err: unknown) {
      this.logger.error(
        `Unexpected error handling bio batch: userId=${userId}`,
        err,
      );
      subscriber.next({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
          timestamp: Date.now(),
        },
      });
    }
  }
}
