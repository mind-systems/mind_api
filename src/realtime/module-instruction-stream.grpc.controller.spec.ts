import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Subject, Subscriber } from 'rxjs';
import { ModuleInstructionStreamGrpcController } from './module-instruction-stream.grpc.controller';
import {
  StreamSample,
  StreamResponse,
} from '../../proto/generated/module_instruction_stream';
import { StreamDataType } from './constants/stream-data-types';
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
    push: jest.fn().mockReturnValue({
      accepted: true,
      droppedCount: 0,
      totalReceived: 1,
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

function makeBreathPhaseSample(sessionId: string): StreamSample {
  return {
    sessionId,
    timestamp: 1000,
    moduleId: 'breath',
    instructionType: StreamDataType.BREATH_PHASE,
    data: undefined,
  };
}

// ── describe ─────────────────────────────────────────────────────────────────

describe('ModuleInstructionStreamGrpcController', () => {
  let controller: ModuleInstructionStreamGrpcController;
  let streamEngine: ReturnType<typeof makeStreamEngine>;
  let activityEngine: ReturnType<typeof makeActivityEngine>;
  let activeStreamRegistry: ReturnType<typeof makeActiveStreamRegistry>;

  beforeEach(() => {
    streamEngine = makeStreamEngine();
    activityEngine = makeActivityEngine();
    activeStreamRegistry = makeActiveStreamRegistry();

    controller = new ModuleInstructionStreamGrpcController(
      streamEngine as any,
      activityEngine as any,
      activeStreamRegistry as any,
    );
  });

  // ── Authentication ────────────────────────────────────────────────────────

  describe('streamData — authentication', () => {
    it('should error with UNAUTHENTICATED RpcException when user is null', (done) => {
      const request$ = new Subject<StreamSample>();
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
      const request$ = new Subject<StreamSample>();
      controller.streamData(request$, null).subscribe({ error: () => {} });
      expect(activeStreamRegistry.register).not.toHaveBeenCalled();
    });
  });

  // ── Pause pass-through (regression) ───────────────────────────────────────

  describe('streamData — pause pass-through', () => {
    it('should call streamEngine.push when session is paused and sample instructionType is breath_phase', (done) => {
      const sessionId = 'session-1';
      activityEngine.getActiveSession.mockReturnValue(
        makePausedSession({ sessionId }),
      );

      const request$ = new Subject<StreamSample>();

      const sub = controller.streamData(request$, makeUser()).subscribe({
        next: (v) => {
          if (v.ack) {
            expect(streamEngine.push).toHaveBeenCalled();
            sub.unsubscribe();
            done();
          }
        },
        error: done,
      });

      request$.next(makeBreathPhaseSample(sessionId));
    });

    it('should respond with ack (not SESSION_PAUSED error) for breath_phase when paused', (done) => {
      const sessionId = 'session-1';
      activityEngine.getActiveSession.mockReturnValue(
        makePausedSession({ sessionId }),
      );

      const request$ = new Subject<StreamSample>();

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

      request$.next(makeBreathPhaseSample(sessionId));
    });

    it('should not emit an error frame for a paused session with a breath_phase sample', (done) => {
      const sessionId = 'session-1';
      activityEngine.getActiveSession.mockReturnValue(
        makePausedSession({ sessionId }),
      );

      const request$ = new Subject<StreamSample>();
      const errorFrames: StreamResponse[] = [];

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

      request$.next(makeBreathPhaseSample(sessionId));
    });

    it('should still emit ready frame on connection even when session is paused', () => {
      const sessionId = 'session-1';
      activityEngine.getActiveSession.mockReturnValue(
        makePausedSession({ sessionId }),
      );

      const request$ = new Subject<StreamSample>();
      const values: StreamResponse[] = [];

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
      const request$ = new Subject<StreamSample>();
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
