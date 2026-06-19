import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Subject, Subscriber } from 'rxjs';
import { ModuleBiometricStreamGrpcController } from './module-biometric-stream.grpc.controller';
import {
  BioSampleBatch,
  BioStreamResponse,
} from '../../proto/generated/module_biometric_stream';
import type { JwtPayload } from '../users/interfaces/auth.interface';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeUser(overrides?: Partial<JwtPayload>): JwtPayload {
  return {
    sub: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    ...overrides,
  };
}

function makePausedSession(overrides?: Partial<{ sessionId: string }>) {
  return {
    sessionId: 'session-1',
    isPaused: true,
    ...overrides,
  } as any;
}

function makeStreamEngine() {
  return {
    maxSamplesPerSecond: 50,
    pushBatch: jest.fn().mockReturnValue({
      acceptedCount: 1,
      droppedCount: 0,
      totalReceived: 1,
      totalDropped: 0,
    }),
  };
}

function makeActivityEngine() {
  return {
    getActiveSession: jest.fn().mockReturnValue(undefined),
  };
}

function makeActiveStreamRegistry() {
  return {
    register: jest.fn(),
    deregister: jest.fn(),
    closeAll: jest.fn(),
  };
}

function makeBatch(sessionId: string, sampleType = 'cardio'): BioSampleBatch {
  return {
    samples: [
      {
        sessionId,
        timestamp: 1000,
        sampleType,
        data: undefined,
      },
    ],
  };
}

// ── describe ─────────────────────────────────────────────────────────────────

describe('ModuleBiometricStreamGrpcController', () => {
  let controller: ModuleBiometricStreamGrpcController;
  let streamEngine: ReturnType<typeof makeStreamEngine>;
  let activityEngine: ReturnType<typeof makeActivityEngine>;
  let activeStreamRegistry: ReturnType<typeof makeActiveStreamRegistry>;

  beforeEach(() => {
    streamEngine = makeStreamEngine();
    activityEngine = makeActivityEngine();
    activeStreamRegistry = makeActiveStreamRegistry();

    controller = new ModuleBiometricStreamGrpcController(
      streamEngine as any,
      activityEngine as any,
      activeStreamRegistry as any,
    );
  });

  // ── Authentication ────────────────────────────────────────────────────────

  describe('streamData — authentication', () => {
    it('should error with UNAUTHENTICATED RpcException when user is null', (done) => {
      const request$ = new Subject<BioSampleBatch>();
      controller.streamData(request$, null).subscribe({
        error: (err: unknown) => {
          expect(err).toBeInstanceOf(RpcException);
          expect((err as RpcException).getError()).toMatchObject({
            code: GrpcStatus.UNAUTHENTICATED,
          });
          done();
        },
      });
    });

    it('should not call activeStreamRegistry.register when user is null', () => {
      const request$ = new Subject<BioSampleBatch>();
      controller.streamData(request$, null).subscribe({ error: () => {} });
      expect(activeStreamRegistry.register).not.toHaveBeenCalled();
    });
  });

  // ── Pause pass-through (regression) ───────────────────────────────────────

  describe('streamData — pause pass-through', () => {
    it('should call streamEngine.pushBatch when session is paused and sessionId matches', (done) => {
      const sessionId = 'session-1';
      activityEngine.getActiveSession.mockReturnValue(
        makePausedSession({ sessionId }),
      );

      const request$ = new Subject<BioSampleBatch>();
      const values: BioStreamResponse[] = [];

      const sub = controller.streamData(request$, makeUser()).subscribe({
        next: (v) => {
          values.push(v);
          if (v.ack) {
            expect(streamEngine.pushBatch).toHaveBeenCalled();
            sub.unsubscribe();
            done();
          }
        },
        error: done,
      });

      request$.next(makeBatch(sessionId));
    });

    it('should respond with ack (not SESSION_PAUSED error) when session is paused', (done) => {
      const sessionId = 'session-1';
      activityEngine.getActiveSession.mockReturnValue(
        makePausedSession({ sessionId }),
      );

      const request$ = new Subject<BioSampleBatch>();

      const sub = controller.streamData(request$, makeUser()).subscribe({
        next: (v) => {
          // Skip the ready frame
          if (v.ready) return;

          expect(v.error?.code).not.toBe('SESSION_PAUSED');
          expect(v.ack).toBeDefined();
          sub.unsubscribe();
          done();
        },
        error: done,
      });

      request$.next(makeBatch(sessionId));
    });

    it('should not emit an error frame for a paused session with a valid batch', (done) => {
      const sessionId = 'session-1';
      activityEngine.getActiveSession.mockReturnValue(
        makePausedSession({ sessionId }),
      );

      const request$ = new Subject<BioSampleBatch>();
      const errorFrames: BioStreamResponse[] = [];

      const sub = controller.streamData(request$, makeUser()).subscribe({
        next: (v) => {
          if (v.error) errorFrames.push(v);
          if (v.ack) {
            expect(errorFrames).toHaveLength(0);
            sub.unsubscribe();
            done();
          }
        },
        error: done,
      });

      request$.next(makeBatch(sessionId));
    });

    it('should still emit ready frame on connection even when session is paused', () => {
      const sessionId = 'session-1';
      activityEngine.getActiveSession.mockReturnValue(
        makePausedSession({ sessionId }),
      );

      const request$ = new Subject<BioSampleBatch>();
      const values: BioStreamResponse[] = [];

      const sub = controller.streamData(request$, makeUser()).subscribe({
        next: (v) => values.push(v),
        error: () => {},
      });

      // ready is emitted synchronously on subscribe
      expect(values).toHaveLength(1);
      expect(values[0].ready).toBeDefined();
      expect(values[0].ready!.maxSamplesPerSecond).toBe(
        streamEngine.maxSamplesPerSecond,
      );

      sub.unsubscribe();
    });

    it('should register subscriber with activeStreamRegistry when user is valid', () => {
      const request$ = new Subject<BioSampleBatch>();
      const sub = controller
        .streamData(request$, makeUser())
        .subscribe({ error: () => {} });
      expect(activeStreamRegistry.register).toHaveBeenCalledWith(
        'user-1',
        expect.any(Subscriber),
      );
      sub.unsubscribe();
    });
  });
});
