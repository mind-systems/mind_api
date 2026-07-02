import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Subscriber } from 'rxjs';
import { SyncStreamGrpcController } from './sync-stream.grpc.controller';
import type { JwtPayload } from '../users/interfaces/auth.interface';
import type { WatchChangesRequest } from '../../proto/generated/sync';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeUser(overrides?: Partial<JwtPayload>): JwtPayload {
  return {
    sub: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    ...overrides,
  };
}

function makeDbEvent(
  overrides?: Partial<{
    id: number;
    entity: string;
    refId: string;
    action: string;
    createdAt: Date;
  }>,
) {
  return {
    id: 1,
    entity: 'breath_session',
    refId: 'ref-1',
    action: 'created',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  } as any;
}

function makeChangeLogService() {
  return {
    getMinEventId: jest.fn().mockResolvedValue(1),
    getChanges: jest
      .fn()
      .mockResolvedValue({ events: [], cursor: 0, hasMore: false }),
  };
}

function makeSyncStreamService() {
  return {
    register: jest.fn(),
    deregister: jest.fn(),
  };
}

function makeActiveStreamRegistry() {
  return {
    register: jest.fn(),
    deregister: jest.fn(),
  };
}

/** Drains the microtask queue enough for async replay() to complete. */
async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

// ── describe ─────────────────────────────────────────────────────────────────

describe('SyncStreamGrpcController', () => {
  let controller: SyncStreamGrpcController;
  let changeLogService: ReturnType<typeof makeChangeLogService>;
  let syncStreamService: ReturnType<typeof makeSyncStreamService>;
  let activeStreamRegistry: ReturnType<typeof makeActiveStreamRegistry>;

  beforeEach(() => {
    changeLogService = makeChangeLogService();
    syncStreamService = makeSyncStreamService();
    activeStreamRegistry = makeActiveStreamRegistry();
    controller = new SyncStreamGrpcController(
      changeLogService as any,
      syncStreamService as any,
      activeStreamRegistry as any,
    );
  });

  // ── Task 1: Authentication gate ───────────────────────────────────────────

  describe('watchChanges — authentication', () => {
    it('should emit UNAUTHENTICATED RpcException when user is null', (done) => {
      controller.watchChanges({}, null).subscribe({
        error: (err: unknown) => {
          expect(err).toBeInstanceOf(RpcException);
          expect((err as RpcException).getError()).toMatchObject({
            code: GrpcStatus.UNAUTHENTICATED,
            message: 'Missing user context',
          });
          done();
        },
      });
    });

    it('should not call any collaborator when user is null', () => {
      controller.watchChanges({}, null).subscribe({ error: () => {} });
      expect(activeStreamRegistry.register).not.toHaveBeenCalled();
      expect(syncStreamService.register).not.toHaveBeenCalled();
      expect(changeLogService.getMinEventId).not.toHaveBeenCalled();
      expect(changeLogService.getChanges).not.toHaveBeenCalled();
    });
  });

  // ── Task 2: Live-only mode (afterId === undefined) and unconditional registrations ──

  describe('watchChanges — live-only mode (afterId === undefined) and unconditional registrations', () => {
    it('should not call changeLogService.getMinEventId when afterId is undefined', async () => {
      const sub = controller
        .watchChanges({}, makeUser())
        .subscribe({ error: () => {} });
      await flushMicrotasks();
      expect(changeLogService.getMinEventId).not.toHaveBeenCalled();
      sub.unsubscribe();
    });

    it('should not call changeLogService.getChanges when afterId is undefined', async () => {
      const sub = controller
        .watchChanges({}, makeUser())
        .subscribe({ error: () => {} });
      await flushMicrotasks();
      expect(changeLogService.getChanges).not.toHaveBeenCalled();
      sub.unsubscribe();
    });

    it('should register the live push listener via syncStreamService unconditionally when watchChanges is invoked', () => {
      const user = makeUser();
      const sub = controller
        .watchChanges({}, user)
        .subscribe({ error: () => {} });
      expect(syncStreamService.register).toHaveBeenCalledWith(
        user.sub,
        expect.any(Function),
      );
      sub.unsubscribe();
    });

    it('should register the subscriber with activeStreamRegistry unconditionally when watchChanges is invoked', () => {
      const user = makeUser();
      const sub = controller
        .watchChanges({}, user)
        .subscribe({ error: () => {} });
      expect(activeStreamRegistry.register).toHaveBeenCalledWith(
        user.sub,
        'sync',
        expect.any(Subscriber),
      );
      sub.unsubscribe();
    });
  });

  // ── Task 3: Single-batch replay (hasMore: false) ──────────────────────────

  describe('watchChanges — single-batch replay (hasMore: false)', () => {
    const afterId = 42;
    const request: WatchChangesRequest = { afterId };

    beforeEach(() => {
      changeLogService.getMinEventId.mockResolvedValue(1);
      changeLogService.getChanges.mockResolvedValue({
        events: [makeDbEvent({ id: 10 })],
        cursor: 42,
        hasMore: false,
      });
    });

    it('should call changeLogService.getMinEventId once when afterId is provided', async () => {
      const sub = controller
        .watchChanges(request, makeUser())
        .subscribe({ error: () => {} });
      await flushMicrotasks();
      expect(changeLogService.getMinEventId).toHaveBeenCalledTimes(1);
      sub.unsubscribe();
    });

    it('should call changeLogService.getChanges once with (userId, Number(afterId), 100) when hasMore is false on first call', async () => {
      const user = makeUser();
      const sub = controller
        .watchChanges(request, user)
        .subscribe({ error: () => {} });
      await flushMicrotasks();
      expect(changeLogService.getChanges).toHaveBeenCalledTimes(1);
      expect(changeLogService.getChanges).toHaveBeenCalledWith(
        user.sub,
        42,
        100,
      );
      sub.unsubscribe();
    });

    it('should emit exactly one ChangeEvent wrapper message when replay returns a single non-empty batch with hasMore false', async () => {
      const emitted: any[] = [];
      const sub = controller.watchChanges(request, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });
      await flushMicrotasks();
      expect(emitted).toHaveLength(1);
      sub.unsubscribe();
    });

    it("should convert each replay event's createdAt Date to an ISO string in the emitted ChangeEvent wrapper", async () => {
      const fixedDate = new Date('2024-06-01T12:00:00.000Z');
      changeLogService.getChanges.mockResolvedValue({
        events: [makeDbEvent({ createdAt: fixedDate })],
        cursor: 42,
        hasMore: false,
      });
      const emitted: any[] = [];
      const sub = controller.watchChanges(request, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });
      await flushMicrotasks();
      expect(emitted[0].events[0].createdAt).toBe(fixedDate.toISOString());
      sub.unsubscribe();
    });

    it("should preserve id, entity, refId and action fields from the replay event in the emitted wrapper's inner event", async () => {
      const dbEvent = makeDbEvent({
        id: 99,
        entity: 'breath_session',
        refId: 'ref-abc',
        action: 'updated',
      });
      changeLogService.getChanges.mockResolvedValue({
        events: [dbEvent],
        cursor: 42,
        hasMore: false,
      });
      const emitted: any[] = [];
      const sub = controller.watchChanges(request, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });
      await flushMicrotasks();
      expect(emitted[0].events[0].id).toBe(99);
      expect(emitted[0].events[0].entity).toBe('breath_session');
      expect(emitted[0].events[0].refId).toBe('ref-abc');
      expect(emitted[0].events[0].action).toBe('updated');
      sub.unsubscribe();
    });
  });

  // ── Task 4: Multi-batch replay (hasMore loop) ─────────────────────────────

  describe('watchChanges — multi-batch replay (hasMore loop)', () => {
    const afterId = 10;
    const request: WatchChangesRequest = { afterId };
    let eventA: any;
    let eventB: any;

    beforeEach(() => {
      eventA = makeDbEvent({
        id: 20,
        entity: 'entity_a',
        refId: 'ref-a',
        action: 'created',
      });
      eventB = makeDbEvent({
        id: 30,
        entity: 'entity_b',
        refId: 'ref-b',
        action: 'updated',
      });
      changeLogService.getMinEventId.mockResolvedValue(1);
      changeLogService.getChanges
        .mockResolvedValueOnce({ events: [eventA], cursor: 50, hasMore: true })
        .mockResolvedValueOnce({
          events: [eventB],
          cursor: 75,
          hasMore: false,
        });
    });

    it('should call changeLogService.getChanges twice when first batch returns hasMore true and second returns hasMore false', async () => {
      const sub = controller
        .watchChanges(request, makeUser())
        .subscribe({ error: () => {} });
      await flushMicrotasks(5);
      expect(changeLogService.getChanges).toHaveBeenCalledTimes(2);
      sub.unsubscribe();
    });

    it('should pass Number(request.afterId) as the cursor argument on the first getChanges call', async () => {
      const user = makeUser();
      const sub = controller
        .watchChanges(request, user)
        .subscribe({ error: () => {} });
      await flushMicrotasks(5);
      expect(changeLogService.getChanges).toHaveBeenNthCalledWith(
        1,
        user.sub,
        10,
        100,
      );
      sub.unsubscribe();
    });

    it("should use the cursor returned by the first batch as the second getChanges call's cursor argument", async () => {
      const user = makeUser();
      const sub = controller
        .watchChanges(request, user)
        .subscribe({ error: () => {} });
      await flushMicrotasks(5);
      expect(changeLogService.getChanges).toHaveBeenNthCalledWith(
        2,
        user.sub,
        50,
        100,
      );
      sub.unsubscribe();
    });

    it('should emit two separate ChangeEvent wrapper messages when replay completes in two non-empty batches', async () => {
      const emitted: any[] = [];
      const sub = controller.watchChanges(request, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });
      await flushMicrotasks(5);
      expect(emitted).toHaveLength(2);
      expect(emitted[0].events[0].id).toBe(eventA.id);
      expect(emitted[1].events[0].id).toBe(eventB.id);
      sub.unsubscribe();
    });

    it('should stop calling getChanges after hasMore becomes false', async () => {
      const sub = controller
        .watchChanges(request, makeUser())
        .subscribe({ error: () => {} });
      await flushMicrotasks(5);
      expect(changeLogService.getChanges).toHaveBeenCalledTimes(2);
      await flushMicrotasks(5);
      expect(changeLogService.getChanges).toHaveBeenCalledTimes(2);
      sub.unsubscribe();
    });
  });

  // ── Task 5: Cursor-too-old → FAILED_PRECONDITION ──────────────────────────

  describe('watchChanges — cursor-too-old → FAILED_PRECONDITION', () => {
    const afterId = 50;
    const request: WatchChangesRequest = { afterId };

    beforeEach(() => {
      changeLogService.getMinEventId.mockResolvedValue(100);
    });

    it('should emit FAILED_PRECONDITION RpcException when afterId is below minEventId and afterId is not 0', (done) => {
      controller.watchChanges(request, makeUser()).subscribe({
        error: (err: unknown) => {
          expect(err).toBeInstanceOf(RpcException);
          expect((err as RpcException).getError()).toMatchObject({
            code: GrpcStatus.FAILED_PRECONDITION,
            message: 'cursor too old, full resync required',
          });
          done();
        },
      });
    });

    it('should call syncStreamService.deregister before emitting the FAILED_PRECONDITION error', async () => {
      const callOrder: string[] = [];
      syncStreamService.deregister = jest.fn(() => {
        callOrder.push('deregister');
      });

      controller.watchChanges(request, makeUser()).subscribe({
        error: () => {
          callOrder.push('error');
        },
      });

      await flushMicrotasks();

      expect(callOrder[0]).toBe('deregister');
      expect(callOrder[1]).toBe('error');
    });

    it('should not call changeLogService.getChanges when the cursor is too old', async () => {
      controller
        .watchChanges(request, makeUser())
        .subscribe({ error: () => {} });
      await flushMicrotasks();
      expect(changeLogService.getChanges).not.toHaveBeenCalled();
    });

    it('should pass the same pushFn captured by syncStreamService.register to syncStreamService.deregister on cursor-too-old', async () => {
      let capturedPushFn: ((events: any[]) => void) | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      const userId = 'user-1';
      const user = makeUser({ sub: userId });
      controller.watchChanges(request, user).subscribe({ error: () => {} });

      await flushMicrotasks();

      expect(syncStreamService.deregister).toHaveBeenCalledWith(
        userId,
        capturedPushFn,
      );
    });
  });

  // ── Task 6: afterId=0 sentinel bypasses cursor check ─────────────────────

  describe('watchChanges — afterId=0 sentinel bypasses cursor check', () => {
    const request: WatchChangesRequest = { afterId: 0 };

    beforeEach(() => {
      changeLogService.getMinEventId.mockResolvedValue(100);
      changeLogService.getChanges.mockResolvedValue({
        events: [makeDbEvent()],
        cursor: 0,
        hasMore: false,
      });
    });

    it('should not emit FAILED_PRECONDITION when afterId is 0 even if minEventId is 100', async () => {
      let errored = false;
      const sub = controller.watchChanges(request, makeUser()).subscribe({
        error: () => {
          errored = true;
        },
      });
      await flushMicrotasks();
      expect(errored).toBe(false);
      sub.unsubscribe();
    });

    it('should proceed to call changeLogService.getChanges when afterId is 0 and minEventId is 100', async () => {
      const user = makeUser();
      const sub = controller
        .watchChanges(request, user)
        .subscribe({ error: () => {} });
      await flushMicrotasks();
      expect(changeLogService.getChanges).toHaveBeenCalledWith(
        user.sub,
        0,
        100,
      );
      sub.unsubscribe();
    });

    it('should emit replayed events normally when afterId is 0 sentinel', async () => {
      const emitted: any[] = [];
      const sub = controller.watchChanges(request, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });
      await flushMicrotasks();
      expect(emitted).toHaveLength(1);
      sub.unsubscribe();
    });
  });

  // ── Task 6b: Empty changelog (minEventId === null) bypasses cursor check ──

  describe('watchChanges — empty changelog (minEventId === null) bypasses cursor check', () => {
    const afterId = 50;
    const request: WatchChangesRequest = { afterId };

    beforeEach(() => {
      changeLogService.getMinEventId.mockResolvedValue(null);
      changeLogService.getChanges.mockResolvedValue({
        events: [],
        cursor: 50,
        hasMore: false,
      });
    });

    it('should not emit FAILED_PRECONDITION when minEventId is null even if afterId is greater than 0', async () => {
      let errored = false;
      const sub = controller.watchChanges(request, makeUser()).subscribe({
        error: () => {
          errored = true;
        },
      });
      await flushMicrotasks();
      expect(errored).toBe(false);
      sub.unsubscribe();
    });

    it('should call changeLogService.getChanges with (userId, Number(afterId), 100) when minEventId is null', async () => {
      const user = makeUser();
      const sub = controller
        .watchChanges(request, user)
        .subscribe({ error: () => {} });
      await flushMicrotasks();
      expect(changeLogService.getChanges).toHaveBeenCalledWith(
        user.sub,
        50,
        100,
      );
      sub.unsubscribe();
    });
  });

  // ── Task 7: Empty batches skipped ─────────────────────────────────────────

  describe('watchChanges — empty batches skipped', () => {
    const afterId = 5;
    const request: WatchChangesRequest = { afterId };

    beforeEach(() => {
      changeLogService.getMinEventId.mockResolvedValue(1);
    });

    it('should not call subscriber.next for a batch whose events array is empty', async () => {
      changeLogService.getChanges.mockResolvedValue({
        events: [],
        cursor: 10,
        hasMore: false,
      });
      const emitted: any[] = [];
      const sub = controller.watchChanges(request, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });
      await flushMicrotasks();
      expect(emitted).toHaveLength(0);
      sub.unsubscribe();
    });

    it('should emit only the non-empty batch when one empty batch and one non-empty batch are returned in sequence', async () => {
      const secondEvent = makeDbEvent({ id: 15 });
      changeLogService.getChanges
        .mockResolvedValueOnce({ events: [], cursor: 5, hasMore: true })
        .mockResolvedValueOnce({
          events: [secondEvent],
          cursor: 10,
          hasMore: false,
        });

      const emitted: any[] = [];
      const sub = controller.watchChanges(request, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });
      await flushMicrotasks(5);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].events[0].id).toBe(secondEvent.id);
      sub.unsubscribe();
    });
  });

  // ── New Task 1: Listener registration ordering ────────────────────────────

  describe('watchChanges — listener registration ordering', () => {
    it('should call syncStreamService.register before changeLogService.getMinEventId is called', async () => {
      const callOrder: string[] = [];
      syncStreamService.register.mockImplementation(() => {
        callOrder.push('register');
      });
      changeLogService.getMinEventId.mockImplementation(() => {
        callOrder.push('getMinEventId');
        return Promise.resolve(1);
      });
      changeLogService.getChanges.mockResolvedValue({
        events: [],
        cursor: 0,
        hasMore: false,
      });

      const sub = controller
        .watchChanges({ afterId: 0 }, makeUser())
        .subscribe({ error: () => {} });
      await flushMicrotasks();

      expect(callOrder[0]).toBe('register');
      expect(callOrder[1]).toBe('getMinEventId');
      sub.unsubscribe();
    });

    it('should call syncStreamService.register before changeLogService.getChanges is called', async () => {
      const callOrder: string[] = [];
      syncStreamService.register.mockImplementation(() => {
        callOrder.push('register');
      });
      changeLogService.getMinEventId.mockImplementation(() => {
        return Promise.resolve(1);
      });
      changeLogService.getChanges.mockImplementation(() => {
        callOrder.push('getChanges');
        return Promise.resolve({ events: [], cursor: 0, hasMore: false });
      });

      const sub = controller
        .watchChanges({ afterId: 0 }, makeUser())
        .subscribe({ error: () => {} });
      await flushMicrotasks();

      expect(callOrder[0]).toBe('register');
      expect(callOrder.indexOf('register')).toBeLessThan(
        callOrder.indexOf('getChanges'),
      );
      sub.unsubscribe();
    });

    it('should call activeStreamRegistry.register before syncStreamService.register', () => {
      const callOrder: string[] = [];
      activeStreamRegistry.register.mockImplementation(() => {
        callOrder.push('activeStreamRegistry.register');
      });
      syncStreamService.register.mockImplementation(() => {
        callOrder.push('syncStreamService.register');
      });

      const sub = controller
        .watchChanges({ afterId: 0 }, makeUser())
        .subscribe({ error: () => {} });

      expect(callOrder[0]).toBe('activeStreamRegistry.register');
      expect(callOrder[1]).toBe('syncStreamService.register');
      sub.unsubscribe();
    });
  });

  // ── New Task 2: Live-only mode — direct delivery via pushFn ───────────────

  describe('watchChanges — live-only mode — direct delivery via pushFn', () => {
    it('should emit a ChangeEvent wrapper directly via subscriber.next when pushFn is invoked in live-only mode', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      const emitted: any[] = [];
      const sub = controller.watchChanges({}, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });
      await flushMicrotasks();

      capturedPushFn!([{ id: 11, entity: 'e', refId: 'r', action: 'created' }]);

      expect(emitted).toHaveLength(1);
      expect(emitted[0].events[0].id).toBe(11);
      sub.unsubscribe();
    });

    it('should preserve raw event fields (id, entity, refId, action) when emitting via pushFn in live-only mode', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      const emitted: any[] = [];
      const sub = controller.watchChanges({}, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });
      await flushMicrotasks();

      capturedPushFn!([
        {
          id: 42,
          entity: 'breath_session',
          refId: 'ref-xyz',
          action: 'updated',
        },
      ]);

      expect(emitted[0].events[0].id).toBe(42);
      expect(emitted[0].events[0].entity).toBe('breath_session');
      expect(emitted[0].events[0].refId).toBe('ref-xyz');
      expect(emitted[0].events[0].action).toBe('updated');
      sub.unsubscribe();
    });

    it('should stamp createdAt as an ISO 8601 string on each event emitted via pushFn', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      const emitted: any[] = [];
      const sub = controller.watchChanges({}, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });
      await flushMicrotasks();

      capturedPushFn!([{ id: 1, entity: 'e', refId: 'r', action: 'created' }]);

      expect(emitted[0].events[0].createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      sub.unsubscribe();
    });

    it('should not buffer events in live-only mode — every pushFn invocation emits a new wrapper', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      const emitted: any[] = [];
      const sub = controller.watchChanges({}, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });
      await flushMicrotasks();

      capturedPushFn!([{ id: 1, entity: 'e', refId: 'r', action: 'created' }]);
      capturedPushFn!([{ id: 2, entity: 'e', refId: 'r', action: 'updated' }]);

      expect(emitted).toHaveLength(2);
      sub.unsubscribe();
    });

    it('should flip isDirect synchronously in live-only mode so pushFn emits immediately without awaiting microtasks', () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      const emitted: any[] = [];
      const sub = controller.watchChanges({}, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });

      // No await — isDirect must already be true at this point
      capturedPushFn!([{ id: 1, entity: 'e', refId: 'r', action: 'created' }]);

      expect(emitted).toHaveLength(1);
      expect(emitted[0].events[0].id).toBe(1);
      sub.unsubscribe();
    });
  });

  // ── New Task 3: Buffer flush after replay ─────────────────────────────────

  describe('watchChanges — buffer flush after replay', () => {
    it('should buffer events delivered during replay and flush them after replay completes', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      changeLogService.getMinEventId.mockResolvedValue(1);
      changeLogService.getChanges.mockResolvedValue({
        events: [makeDbEvent({ id: 50 })],
        cursor: 50,
        hasMore: false,
      });

      const emitted: any[] = [];
      const sub = controller
        .watchChanges({ afterId: 10 }, makeUser())
        .subscribe({
          next: (v) => emitted.push(v),
          error: () => {},
        });

      // Push while isDirect === false (replay not yet complete)
      capturedPushFn!([
        { id: 101, entity: 'e', refId: 'r', action: 'created' },
      ]);

      await flushMicrotasks();

      expect(emitted).toHaveLength(2);
      expect(emitted[0].events[0].id).toBe(50);
      expect(emitted[1].events[0].id).toBe(101);
      sub.unsubscribe();
    });

    it('should filter buffered events whose id is less than or equal to lastReplayedCursor before flushing', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      changeLogService.getMinEventId.mockResolvedValue(1);
      changeLogService.getChanges.mockResolvedValue({
        events: [makeDbEvent({ id: 100 })],
        cursor: 100,
        hasMore: false,
      });

      const emitted: any[] = [];
      const sub = controller
        .watchChanges({ afterId: 10 }, makeUser())
        .subscribe({
          next: (v) => emitted.push(v),
          error: () => {},
        });

      capturedPushFn!([
        { id: 95, entity: 'e', refId: 'r', action: 'created' },
        { id: 100, entity: 'e', refId: 'r', action: 'updated' },
        { id: 101, entity: 'e', refId: 'r', action: 'created' },
        { id: 105, entity: 'e', refId: 'r', action: 'deleted' },
      ]);

      await flushMicrotasks();

      expect(emitted).toHaveLength(2);
      const flushEmission = emitted[1];
      expect(flushEmission.events).toHaveLength(2);
      expect(flushEmission.events[0].id).toBe(101);
      expect(flushEmission.events[1].id).toBe(105);
      sub.unsubscribe();
    });

    it('should emit no flush wrapper when every buffered event id is at or below lastReplayedCursor', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      changeLogService.getMinEventId.mockResolvedValue(1);
      changeLogService.getChanges.mockResolvedValue({
        events: [makeDbEvent({ id: 100 })],
        cursor: 100,
        hasMore: false,
      });

      const emitted: any[] = [];
      const sub = controller
        .watchChanges({ afterId: 10 }, makeUser())
        .subscribe({
          next: (v) => emitted.push(v),
          error: () => {},
        });

      capturedPushFn!([
        { id: 50, entity: 'e', refId: 'r', action: 'created' },
        { id: 100, entity: 'e', refId: 'r', action: 'updated' },
      ]);

      await flushMicrotasks();

      // Only the replay wrapper — no flush wrapper because all buffered ids <= cursor
      expect(emitted).toHaveLength(1);
      sub.unsubscribe();
    });

    it('should clear the buffer after flushing — subsequent pushFn calls do not re-emit flushed events', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      changeLogService.getMinEventId.mockResolvedValue(1);
      changeLogService.getChanges.mockResolvedValue({
        events: [makeDbEvent({ id: 50 })],
        cursor: 50,
        hasMore: false,
      });

      const emitted: any[] = [];
      const sub = controller
        .watchChanges({ afterId: 10 }, makeUser())
        .subscribe({
          next: (v) => emitted.push(v),
          error: () => {},
        });

      // Push into buffer during replay
      capturedPushFn!([
        { id: 101, entity: 'e', refId: 'r', action: 'created' },
      ]);

      await flushMicrotasks();

      // Now isDirect === true; push a new event
      capturedPushFn!([
        { id: 200, entity: 'e', refId: 'r', action: 'created' },
      ]);

      // The latest wrapper must contain only id=200 — buffer was drained by splice(0)
      const lastEmission = emitted[emitted.length - 1];
      expect(lastEmission.events).toHaveLength(1);
      expect(lastEmission.events[0].id).toBe(200);
      sub.unsubscribe();
    });
  });

  // ── New Task 4: Direct-mode boundary-straddle dedup ───────────────────────

  describe('watchChanges — direct-mode boundary-straddle dedup (pushFn after replay)', () => {
    it('should drop direct-mode events whose id is less than or equal to lastReplayedCursor', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      changeLogService.getMinEventId.mockResolvedValue(1);
      changeLogService.getChanges.mockResolvedValue({
        events: [makeDbEvent({ id: 100 })],
        cursor: 100,
        hasMore: false,
      });

      const emitted: any[] = [];
      const sub = controller
        .watchChanges({ afterId: 10 }, makeUser())
        .subscribe({
          next: (v) => emitted.push(v),
          error: () => {},
        });

      await flushMicrotasks();

      // Now isDirect === true; lastReplayedCursor === 100
      capturedPushFn!([
        { id: 98, entity: 'e', refId: 'r', action: 'created' },
        { id: 100, entity: 'e', refId: 'r', action: 'updated' },
        { id: 102, entity: 'e', refId: 'r', action: 'created' },
        { id: 105, entity: 'e', refId: 'r', action: 'deleted' },
      ]);

      expect(emitted).toHaveLength(2);
      const directEmission = emitted[1];
      expect(directEmission.events).toHaveLength(2);
      expect(directEmission.events[0].id).toBe(102);
      expect(directEmission.events[1].id).toBe(105);
      sub.unsubscribe();
    });

    it('should not call subscriber.next when every direct-mode event id is at or below lastReplayedCursor', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      changeLogService.getMinEventId.mockResolvedValue(1);
      changeLogService.getChanges.mockResolvedValue({
        events: [makeDbEvent({ id: 100 })],
        cursor: 100,
        hasMore: false,
      });

      const emitted: any[] = [];
      const sub = controller
        .watchChanges({ afterId: 10 }, makeUser())
        .subscribe({
          next: (v) => emitted.push(v),
          error: () => {},
        });

      await flushMicrotasks();

      const lengthBeforePush = emitted.length;

      capturedPushFn!([
        { id: 50, entity: 'e', refId: 'r', action: 'created' },
        { id: 100, entity: 'e', refId: 'r', action: 'updated' },
      ]);

      expect(emitted).toHaveLength(lengthBeforePush);
      sub.unsubscribe();
    });

    it('should emit all direct-mode events when every id is strictly greater than lastReplayedCursor', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      changeLogService.getMinEventId.mockResolvedValue(1);
      changeLogService.getChanges.mockResolvedValue({
        events: [makeDbEvent({ id: 100 })],
        cursor: 100,
        hasMore: false,
      });

      const emitted: any[] = [];
      const sub = controller
        .watchChanges({ afterId: 10 }, makeUser())
        .subscribe({
          next: (v) => emitted.push(v),
          error: () => {},
        });

      await flushMicrotasks();

      capturedPushFn!([
        { id: 200, entity: 'e', refId: 'r', action: 'created' },
        { id: 300, entity: 'e', refId: 'r', action: 'updated' },
      ]);

      expect(emitted).toHaveLength(2);
      const directEmission = emitted[1];
      expect(directEmission.events).toHaveLength(2);
      expect(directEmission.events[0].id).toBe(200);
      expect(directEmission.events[1].id).toBe(300);
      sub.unsubscribe();
    });

    it('should stamp createdAt as an ISO 8601 string on direct-mode events', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      changeLogService.getMinEventId.mockResolvedValue(1);
      changeLogService.getChanges.mockResolvedValue({
        events: [makeDbEvent({ id: 100 })],
        cursor: 100,
        hasMore: false,
      });

      const emitted: any[] = [];
      const sub = controller
        .watchChanges({ afterId: 10 }, makeUser())
        .subscribe({
          next: (v) => emitted.push(v),
          error: () => {},
        });

      await flushMicrotasks();

      capturedPushFn!([
        { id: 200, entity: 'e', refId: 'r', action: 'created' },
      ]);

      expect(emitted[1].events[0].createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      sub.unsubscribe();
    });
  });

  // ── New Task 5: Teardown via subscription.unsubscribe() ───────────────────

  describe('watchChanges — teardown via subscription.unsubscribe()', () => {
    it('should call activeStreamRegistry.deregister with (userId, subscriber) when the subscription is unsubscribed', () => {
      const user = makeUser();
      const sub = controller
        .watchChanges({}, user)
        .subscribe({ error: () => {} });
      sub.unsubscribe();
      expect(activeStreamRegistry.deregister).toHaveBeenCalledWith(
        user.sub,
        'sync',
        expect.any(Subscriber),
      );
    });

    it('should call syncStreamService.deregister with (userId, pushFn) when the subscription is unsubscribed', () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      const user = makeUser();
      const sub = controller
        .watchChanges({}, user)
        .subscribe({ error: () => {} });
      sub.unsubscribe();

      expect(syncStreamService.deregister).toHaveBeenCalledWith(
        user.sub,
        capturedPushFn,
      );
    });

    it('should not call activeStreamRegistry.deregister or syncStreamService.deregister before unsubscribe', async () => {
      const sub = controller
        .watchChanges({}, makeUser())
        .subscribe({ error: () => {} });
      await flushMicrotasks();

      expect(activeStreamRegistry.deregister).not.toHaveBeenCalled();
      expect(syncStreamService.deregister).not.toHaveBeenCalled();

      sub.unsubscribe();
    });

    it('should call syncStreamService.deregister exactly twice on the cursor-too-old path (explicit + teardown)', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      changeLogService.getMinEventId.mockResolvedValue(100);

      const user = makeUser();
      controller
        .watchChanges({ afterId: 50 }, user)
        .subscribe({ error: () => {} });

      await flushMicrotasks();

      expect(syncStreamService.deregister).toHaveBeenCalledTimes(2);
      expect(syncStreamService.deregister).toHaveBeenNthCalledWith(
        1,
        user.sub,
        capturedPushFn,
      );
      expect(syncStreamService.deregister).toHaveBeenNthCalledWith(
        2,
        user.sub,
        capturedPushFn,
      );
    });

    it('should not throw when syncStreamService.deregister is invoked twice on the cursor-too-old path', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      changeLogService.getMinEventId.mockResolvedValue(100);

      let errorReceived: any;
      controller.watchChanges({ afterId: 50 }, makeUser()).subscribe({
        error: (e) => {
          errorReceived = e;
        },
      });

      await flushMicrotasks();

      // Default jest.fn() does not throw — double-call is safe
      expect(syncStreamService.deregister).toHaveBeenCalledTimes(2);
      expect(errorReceived).toBeInstanceOf(RpcException);
      void capturedPushFn; // captured for context — double-call uses same ref
    });

    it('should call activeStreamRegistry.deregister exactly once on the cursor-too-old path', async () => {
      changeLogService.getMinEventId.mockResolvedValue(100);

      const user = makeUser();
      controller
        .watchChanges({ afterId: 50 }, user)
        .subscribe({ error: () => {} });

      await flushMicrotasks();

      expect(activeStreamRegistry.deregister).toHaveBeenCalledTimes(1);
      expect(activeStreamRegistry.deregister).toHaveBeenCalledWith(
        user.sub,
        'sync',
        expect.any(Subscriber),
      );
    });
  });

  // ── New Task 6: subscriber.closed short-circuit inside replay loop ─────────

  describe('watchChanges — subscriber.closed short-circuit inside replay loop', () => {
    it('should stop calling changeLogService.getChanges once the subscriber unsubscribes mid-replay', async () => {
      changeLogService.getMinEventId.mockResolvedValue(0);

      let subRef: any;

      changeLogService.getChanges
        .mockImplementationOnce(() =>
          Promise.resolve({
            events: [makeDbEvent({ id: 10 })],
            cursor: 10,
            hasMore: true,
          }),
        )
        .mockImplementationOnce(() => {
          subRef!.unsubscribe();
          return Promise.resolve({
            events: [makeDbEvent({ id: 10 })],
            cursor: 10,
            hasMore: true,
          });
        })
        .mockImplementationOnce(() =>
          Promise.resolve({
            events: [makeDbEvent({ id: 10 })],
            cursor: 10,
            hasMore: true,
          }),
        )
        .mockImplementationOnce(() =>
          Promise.resolve({ events: [], cursor: 10, hasMore: false }),
        );

      subRef = controller
        .watchChanges({ afterId: 0 }, makeUser())
        .subscribe({ error: () => {} });

      await flushMicrotasks(10);

      expect(changeLogService.getChanges).toHaveBeenCalledTimes(2);
    });

    it('should not emit further ChangeEvent wrappers after the subscriber unsubscribes mid-replay', async () => {
      changeLogService.getMinEventId.mockResolvedValue(0);

      let subRef: any;
      const emitted: any[] = [];

      changeLogService.getChanges
        .mockImplementationOnce(() =>
          Promise.resolve({
            events: [makeDbEvent({ id: 10 })],
            cursor: 10,
            hasMore: true,
          }),
        )
        .mockImplementationOnce(() => {
          subRef!.unsubscribe();
          return Promise.resolve({
            events: [makeDbEvent({ id: 10 })],
            cursor: 10,
            hasMore: true,
          });
        })
        .mockImplementationOnce(() =>
          Promise.resolve({
            events: [makeDbEvent({ id: 10 })],
            cursor: 10,
            hasMore: true,
          }),
        )
        .mockImplementationOnce(() =>
          Promise.resolve({ events: [], cursor: 10, hasMore: false }),
        );

      subRef = controller.watchChanges({ afterId: 0 }, makeUser()).subscribe({
        next: (v) => emitted.push(v),
        error: () => {},
      });

      await flushMicrotasks(10);

      expect(emitted).toHaveLength(1);
    });

    it('should still run the subscriber.add teardown (both deregister calls) when unsubscribe happens mid-replay', async () => {
      let capturedPushFn:
        | ((
            events: Array<{
              id: number;
              entity: string;
              refId: string;
              action: string;
            }>,
          ) => void)
        | undefined;
      syncStreamService.register.mockImplementation((_userId, fn) => {
        capturedPushFn = fn;
      });

      changeLogService.getMinEventId.mockResolvedValue(0);

      let subRef: any;

      changeLogService.getChanges
        .mockImplementationOnce(() =>
          Promise.resolve({
            events: [makeDbEvent({ id: 10 })],
            cursor: 10,
            hasMore: true,
          }),
        )
        .mockImplementationOnce(() => {
          subRef!.unsubscribe();
          return Promise.resolve({
            events: [makeDbEvent({ id: 10 })],
            cursor: 10,
            hasMore: true,
          });
        })
        .mockImplementationOnce(() =>
          Promise.resolve({
            events: [makeDbEvent({ id: 10 })],
            cursor: 10,
            hasMore: true,
          }),
        )
        .mockImplementationOnce(() =>
          Promise.resolve({ events: [], cursor: 10, hasMore: false }),
        );

      const user = makeUser();
      subRef = controller
        .watchChanges({ afterId: 0 }, user)
        .subscribe({ error: () => {} });

      await flushMicrotasks(10);

      expect(activeStreamRegistry.deregister).toHaveBeenCalledWith(
        user.sub,
        'sync',
        expect.any(Subscriber),
      );
      expect(syncStreamService.deregister).toHaveBeenCalledWith(
        user.sub,
        capturedPushFn,
      );
    });
  });
});
