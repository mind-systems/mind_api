import { SyncStreamService, LiveEvent } from './sync-stream.service';

function makePayload(
  userId: string,
  overrides: Partial<{ id: number; entity: string; refId: string; action: string }> = {},
): any {
  return {
    id: overrides.id ?? 1,
    entity: overrides.entity ?? 'breath_session',
    refId: overrides.refId ?? 'ref-1',
    action: overrides.action ?? 'CREATED',
    userId,
  };
}

describe('SyncStreamService', () => {
  let service: SyncStreamService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new SyncStreamService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ──────────────────────────────────────────────
  // Phase 1: register()
  // ──────────────────────────────────────────────

  describe('register()', () => {
    it('should create a new entry for a userId when the first callback is registered', () => {
      const cb = jest.fn();
      service.register('u1', cb);
      service.onChangeLogged(makePayload('u1'));
      jest.advanceTimersByTime(300);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should add a second callback to the same userId without replacing the first', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      service.register('u1', cb1);
      service.register('u1', cb2);
      service.onChangeLogged(makePayload('u1'));
      jest.advanceTimersByTime(300);
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate via Set when the same callback reference is registered twice for the same userId', () => {
      const cb = jest.fn();
      service.register('u1', cb);
      service.register('u1', cb);
      service.onChangeLogged(makePayload('u1'));
      jest.advanceTimersByTime(300);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should keep callback Sets separate per userId when registering for multiple users', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      service.register('u1', cb1);
      service.register('u2', cb2);
      service.onChangeLogged(makePayload('u1'));
      jest.advanceTimersByTime(300);
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // Phase 2: deregister()
  // ──────────────────────────────────────────────

  describe('deregister()', () => {
    it('should be a no-op when called with an unknown userId', () => {
      expect(() => service.deregister('ghost', jest.fn())).not.toThrow();
    });

    it('should be a no-op when called with a callback that was never registered for that userId', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      service.register('u1', cb1);
      expect(() => service.deregister('u1', cb2)).not.toThrow();
      service.onChangeLogged(makePayload('u1'));
      jest.advanceTimersByTime(300);
      expect(cb1).toHaveBeenCalledTimes(1);
    });

    it('should remove the callback from the Set without deleting the entry when other callbacks remain', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      service.register('u1', cb1);
      service.register('u1', cb2);
      service.deregister('u1', cb1);
      service.onChangeLogged(makePayload('u1'));
      jest.advanceTimersByTime(300);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('should delete the user entry when the last callback is removed', () => {
      const cb = jest.fn();
      service.register('u1', cb);
      service.deregister('u1', cb);
      service.onChangeLogged(makePayload('u1'));
      jest.advanceTimersByTime(300);
      expect(cb).not.toHaveBeenCalled();
    });

    it('should clear the pending debounce timer when the last callback for a userId is removed', () => {
      const cb = jest.fn();
      service.register('u1', cb);
      service.onChangeLogged(makePayload('u1'));
      service.deregister('u1', cb);
      jest.advanceTimersByTime(300);
      expect(cb).not.toHaveBeenCalled();
    });

    it("should not affect other users' entries when deregistering a callback for one userId", () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      service.register('u1', cb1);
      service.register('u2', cb2);
      service.deregister('u1', cb1);
      service.onChangeLogged(makePayload('u2'));
      jest.advanceTimersByTime(300);
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────
  // Phase 3: onChangeLogged() — debounce logic
  // ──────────────────────────────────────────────

  describe('onChangeLogged()', () => {
    it("should be a no-op when the payload's userId is not registered", () => {
      const cb = jest.fn();
      service.onChangeLogged(makePayload('ghost'));
      jest.advanceTimersByTime(300);
      expect(cb).not.toHaveBeenCalled();
    });

    it('should create a 300ms pending timer on the first event for a registered userId', () => {
      const cb = jest.fn();
      service.register('u1', cb);
      service.onChangeLogged(makePayload('u1'));
      expect(cb).not.toHaveBeenCalled();
      jest.advanceTimersByTime(300);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should append subsequent events to the same pending batch when they arrive within 300ms', () => {
      const cb = jest.fn();
      service.register('u1', cb);
      service.onChangeLogged(makePayload('u1', { id: 1 }));
      service.onChangeLogged(makePayload('u1', { id: 2 }));
      service.onChangeLogged(makePayload('u1', { id: 3 }));
      jest.advanceTimersByTime(300);
      expect(cb).toHaveBeenCalledTimes(1);
      const [events] = cb.mock.calls[0] as [LiveEvent[]];
      expect(events).toHaveLength(3);
    });

    it('should not create a new timer when an event arrives while a pending batch already exists', () => {
      const cb = jest.fn();
      service.register('u1', cb);
      service.onChangeLogged(makePayload('u1', { id: 1 }));
      jest.advanceTimersByTime(100);
      service.onChangeLogged(makePayload('u1', { id: 2 }));
      jest.advanceTimersByTime(200); // total 300ms from the first timer
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should flush exactly once when multiple events arrive within the debounce window', () => {
      const cb = jest.fn();
      service.register('u1', cb);
      for (let i = 0; i < 5; i++) {
        service.onChangeLogged(makePayload('u1', { id: i }));
      }
      jest.advanceTimersByTime(300);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should deliver only the LiveEvent fields { id, entity, refId, action } from the payload, with no userId key on the emitted object', () => {
      const cb = jest.fn();
      service.register('u1', cb);
      service.onChangeLogged({
        id: 42,
        entity: 'breath_session' as any,
        refId: 'ref-abc',
        action: 'CREATED' as any,
        userId: 'u1',
      });
      jest.advanceTimersByTime(300);
      expect(cb).toHaveBeenCalledWith([
        { id: 42, entity: 'breath_session', refId: 'ref-abc', action: 'CREATED' },
      ]);
    });

    it('should preserve event arrival order (FIFO) in the flushed batch', () => {
      const cb = jest.fn();
      service.register('u1', cb);
      service.onChangeLogged(makePayload('u1', { id: 10 }));
      service.onChangeLogged(makePayload('u1', { id: 20 }));
      service.onChangeLogged(makePayload('u1', { id: 30 }));
      jest.advanceTimersByTime(300);
      const [events] = cb.mock.calls[0] as [LiveEvent[]];
      expect(events.map((e) => e.id)).toEqual([10, 20, 30]);
    });

    it('should allow a new pending batch to be created after a previous batch has flushed', () => {
      const cb = jest.fn();
      service.register('u1', cb);
      service.onChangeLogged(makePayload('u1', { id: 1 }));
      jest.advanceTimersByTime(300);
      expect(cb).toHaveBeenCalledTimes(1);

      service.onChangeLogged(makePayload('u1', { id: 2 }));
      jest.advanceTimersByTime(300);
      expect(cb).toHaveBeenCalledTimes(2);
    });
  });

  // ──────────────────────────────────────────────
  // Phase 4: Fan-out delivery
  // ──────────────────────────────────────────────

  describe('fan-out delivery', () => {
    it('should invoke every registered callback for a userId with the accumulated events array when the timer fires', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      const cb3 = jest.fn();
      service.register('u1', cb1);
      service.register('u1', cb2);
      service.register('u1', cb3);
      service.onChangeLogged(makePayload('u1'));
      jest.advanceTimersByTime(300);
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
      expect(cb3).toHaveBeenCalledTimes(1);
    });

    it('should pass the same events array reference to every callback in a single fan-out', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      service.register('u1', cb1);
      service.register('u1', cb2);
      service.onChangeLogged(makePayload('u1'));
      jest.advanceTimersByTime(300);
      const events1 = cb1.mock.calls[0][0] as LiveEvent[];
      const events2 = cb2.mock.calls[0][0] as LiveEvent[];
      expect(events1).toBe(events2);
    });

    it('should deliver events only to callbacks registered for the matching userId, not to callbacks registered for other userIds', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      service.register('u1', cb1);
      service.register('u2', cb2);
      service.onChangeLogged(makePayload('u1'));
      jest.advanceTimersByTime(300);
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).not.toHaveBeenCalled();
    });

    it('should not invoke a deregistered callback when the timer fires after its removal', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      service.register('u1', cb1);
      service.register('u1', cb2);
      service.onChangeLogged(makePayload('u1'));
      service.deregister('u1', cb1);
      jest.advanceTimersByTime(300);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────
  // Phase 5: for...of error propagation (documented behavior)
  // ──────────────────────────────────────────────

  describe('for...of error propagation (documented behavior)', () => {
    it('should stop iterating callbacks when the first callback throws, leaving subsequent callbacks uninvoked (documented behavior)', () => {
      const cbA = jest.fn(() => {
        throw new Error('boom');
      });
      const cbB = jest.fn();
      const cbC = jest.fn();
      service.register('u1', cbA);
      service.register('u1', cbB);
      service.register('u1', cbC);
      service.onChangeLogged(makePayload('u1'));
      try {
        jest.advanceTimersByTime(300);
      } catch {
        // expected — cbA throws; fake timers propagate it synchronously
      }
      expect(cbA).toHaveBeenCalledTimes(1);
      expect(cbB).not.toHaveBeenCalled();
      expect(cbC).not.toHaveBeenCalled();
    });

    it('should surface the thrown error out of the fake-timer tick', () => {
      const cbA = jest.fn(() => {
        throw new Error('boom');
      });
      service.register('u1', cbA);
      service.onChangeLogged(makePayload('u1'));
      expect(() => jest.advanceTimersByTime(300)).toThrow('boom');
    });

    it('should allow a new pending batch to be created on the same userId after a previous flush threw', () => {
      const throwing = jest.fn(() => {
        throw new Error('boom');
      });
      const safe = jest.fn();
      service.register('u1', throwing);
      service.onChangeLogged(makePayload('u1', { id: 1 }));
      // flush() sets entry.pending = null before the for...of loop, so the entry survives the throw
      expect(() => jest.advanceTimersByTime(300)).toThrow();

      // Replace the throwing callback with a safe one — entry still exists in streams
      service.deregister('u1', throwing);
      service.register('u1', safe);
      service.onChangeLogged(makePayload('u1', { id: 2 }));
      jest.advanceTimersByTime(300);
      expect(safe).toHaveBeenCalledTimes(1);
      expect(safe).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 2 })]),
      );
    });
  });

  // ──────────────────────────────────────────────
  // Phase 6: onModuleDestroy()
  // ──────────────────────────────────────────────

  describe('onModuleDestroy()', () => {
    it('should clear all pending debounce timers across all registered userIds so no callbacks fire afterwards', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      service.register('u1', cb1);
      service.register('u2', cb2);
      service.onChangeLogged(makePayload('u1'));
      service.onChangeLogged(makePayload('u2'));
      service.onModuleDestroy();
      jest.advanceTimersByTime(1000);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).not.toHaveBeenCalled();
    });

    it('should drop all registrations so a subsequent onChangeLogged for a previously-registered user is a no-op', () => {
      const cb = jest.fn();
      service.register('u1', cb);
      service.onModuleDestroy();
      service.onChangeLogged(makePayload('u1'));
      jest.advanceTimersByTime(300);
      expect(cb).not.toHaveBeenCalled();
    });

    it('should be safe to call on an empty registry without throwing', () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
    });

    it('should be safe to call twice in a row without throwing', () => {
      service.register('u1', jest.fn());
      expect(() => {
        service.onModuleDestroy();
        service.onModuleDestroy();
      }).not.toThrow();
    });
  });
});
