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
    // ensureRoot does not exist yet on ActivityEngine — accessed as (engine as any).ensureRoot (P1, L2 compile-now)
    ensureRoot: jest.fn().mockResolvedValue(undefined),
  };
}

function makeRoot(overrides?: Partial<{ id: string; isPaused: boolean }>): {
  id: string;
  activityType: string;
  isPaused: boolean;
} {
  return {
    id: 'root-1',
    activityType: 'root',
    isPaused: false,
    ...overrides,
  };
}

/**
 * P6 — two-state observability helper.
 * Subscribes to streamData, sends the batch, and resolves with the first
 * response frame whose `.ready` is undefined (i.e. an ack or an error frame).
 * Never hangs: even when the controller emits a NO_SESSION error (the current
 * behavior), that error frame is captured immediately and returned as a clean RED.
 */
function firstNonReadyFrame(
  controller: ModuleBiometricStreamGrpcController,
  request$: Subject<BioSampleBatch>,
  user: ReturnType<typeof makeUser>,
  batch: BioSampleBatch,
): Promise<BioStreamResponse> {
  return new Promise<BioStreamResponse>((resolve, reject) => {
    const sub = controller.streamData(request$, user).subscribe({
      next: (frame) => {
        if (frame.ready !== undefined) return; // skip the ready frame
        sub.unsubscribe();
        resolve(frame);
      },
      error: reject,
    });
    request$.next(batch);
  });
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

  // ── Batch consistency smoke (characterization — must stay GREEN) ─────────────
  // Steps 1–4 run before root resolution, so they are unaffected by spec 10.
  // Assert each rejection code once (L1 — loud paths, do not over-test).
  // P6: firstNonReadyFrame is used so the helper is exercised even here.

  describe('streamData — batch consistency (smoke, characterization)', () => {
    it('[characterization — must stay GREEN] should reject an empty batch with INVALID_ARGUMENT', async () => {
      const request$ = new Subject<BioSampleBatch>();
      const frame = await firstNonReadyFrame(controller, request$, makeUser(), {
        samples: [],
      });

      expect(frame.error).toBeDefined();
      expect(frame.error!.code).toBe('INVALID_ARGUMENT');
    });

    it('[characterization — must stay GREEN] should reject a batch with missing sessionId with INVALID_ARGUMENT', async () => {
      const request$ = new Subject<BioSampleBatch>();
      const frame = await firstNonReadyFrame(
        controller,
        request$,
        makeUser(),
        makeBatch(''), // sessionId === ''
      );

      expect(frame.error).toBeDefined();
      expect(frame.error!.code).toBe('INVALID_ARGUMENT');
    });

    it('[characterization — must stay GREEN] should reject a batch with inconsistent sessionId across samples with INVALID_ARGUMENT', async () => {
      const request$ = new Subject<BioSampleBatch>();
      const batch: BioSampleBatch = {
        samples: [
          {
            sessionId: 'session-a',
            timestamp: 1000,
            sampleType: 'cardio',
            data: undefined,
          },
          {
            sessionId: 'session-b',
            timestamp: 1001,
            sampleType: 'cardio',
            data: undefined,
          },
        ],
      };
      const frame = await firstNonReadyFrame(
        controller,
        request$,
        makeUser(),
        batch,
      );

      expect(frame.error).toBeDefined();
      expect(frame.error!.code).toBe('INVALID_ARGUMENT');
    });

    it('[characterization — must stay GREEN] should reject a batch with missing sampleType with INVALID_ARGUMENT', async () => {
      const request$ = new Subject<BioSampleBatch>();
      const frame = await firstNonReadyFrame(
        controller,
        request$,
        makeUser(),
        makeBatch('session-1', ''), // sampleType === ''
      );

      expect(frame.error).toBeDefined();
      expect(frame.error!.code).toBe('INVALID_ARGUMENT');
    });
  });

  // ── Bio bound to root (target — RED until spec 10-bio-ingest-to-root) ────────
  // P6: each case uses firstNonReadyFrame to capture the first non-ready response
  // frame synchronously, avoiding hangs when the controller emits an error today.

  describe('streamData — bio bound to root', () => {
    it('[RED until spec 10-bio-ingest-to-root] should resolve the user root and call pushBatch(root.id, …)', async () => {
      // P1: stub ensureRoot (not getActiveSession)
      activityEngine.ensureRoot.mockResolvedValue(makeRoot({ id: 'root-1' }));

      const request$ = new Subject<BioSampleBatch>();
      const frame = await firstNonReadyFrame(
        controller,
        request$,
        makeUser(),
        makeBatch('root-1'),
      );

      // P2, L1 outcome: ack frame with sessionId === root.id
      expect(frame.ack).toBeDefined();
      expect(frame.ack!.sessionId).toBe('root-1');
      // L1: pushBatch was called with root.id as the first argument
      expect(streamEngine.pushBatch).toHaveBeenCalledWith(
        'root-1',
        expect.any(Array),
      );
    });

    it('[RED until spec 10-bio-ingest-to-root] should reject a batch whose session_id is a child id with SESSION_MISMATCH', async () => {
      // P1: ensureRoot returns root-1, but batch carries child-9
      activityEngine.ensureRoot.mockResolvedValue(makeRoot({ id: 'root-1' }));

      const request$ = new Subject<BioSampleBatch>();
      const frame = await firstNonReadyFrame(
        controller,
        request$,
        makeUser(),
        makeBatch('child-9'),
      );

      // P3, L1: error code is the literal string 'SESSION_MISMATCH'
      expect(frame.error).toBeDefined();
      expect(frame.error!.code).toBe('SESSION_MISMATCH');
      expect(streamEngine.pushBatch).not.toHaveBeenCalled();
    });

    it('[RED until spec 10-bio-ingest-to-root] should emit NO_ROOT_SESSION when ensureRoot yields nothing', async () => {
      // P1: ensureRoot returns undefined — the unexpected no-root case
      activityEngine.ensureRoot.mockResolvedValue(undefined);

      const request$ = new Subject<BioSampleBatch>();
      const frame = await firstNonReadyFrame(
        controller,
        request$,
        makeUser(),
        makeBatch('root-1'),
      );

      // P3, L1: error code is the literal string 'NO_ROOT_SESSION'
      expect(frame.error).toBeDefined();
      expect(frame.error!.code).toBe('NO_ROOT_SESSION');
    });

    it('[RED until spec 10-bio-ingest-to-root] should accept a batch for a paused root (pause does not block bio — P5 forward invariant)', async () => {
      // P5: pause must not block bio ingest even when root isPaused === true
      activityEngine.ensureRoot.mockResolvedValue(
        makeRoot({ id: 'root-1', isPaused: true }),
      );

      const request$ = new Subject<BioSampleBatch>();
      const frame = await firstNonReadyFrame(
        controller,
        request$,
        makeUser(),
        makeBatch('root-1'),
      );

      // L1: first non-ready frame is an ack, not an error
      expect(frame.ack).toBeDefined();
      expect(frame.error).toBeUndefined();
      expect(streamEngine.pushBatch).toHaveBeenCalled();
    });
  });
});
