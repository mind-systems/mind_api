import { ActivitySessionStore } from './activity-session-store.service';
import { ActivityState } from '../interfaces/activity-state.interface';
import { ActivityType } from '../enums/activity-type.enum';

function makeActivitySessionStore(graceMs?: number): ActivitySessionStore {
  const configService = {
    get: jest.fn().mockReturnValue(graceMs),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return new ActivitySessionStore(configService as any);
}

function makeActivityState(
  overrides: Partial<ActivityState> = {},
): ActivityState {
  const now = new Date();
  return {
    sessionId: 'session-1',
    activityType: ActivityType.BREATH,
    startedAt: now,
    lastActivityAt: now,
    isPaused: false,
    ...overrides,
  };
}

describe('ActivitySessionStore', () => {
  let store: ActivitySessionStore;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Phase 1: constructor ─────────────────────────────────────────────────

  describe('constructor', () => {
    it('should use the default grace period of 30000ms when ConfigService.get returns undefined', () => {
      store = makeActivitySessionStore(undefined);
      const cb = jest.fn();
      store.startGraceTimerForSession('session-1', cb);

      jest.advanceTimersByTime(29_999);
      expect(cb).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should use the custom grace period from ConfigService when WS_RECONNECT_GRACE_MS is set', () => {
      store = makeActivitySessionStore(5_000);
      const cb = jest.fn();
      store.startGraceTimerForSession('session-1', cb);

      jest.advanceTimersByTime(4_999);
      expect(cb).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should query ConfigService with the key "WS_RECONNECT_GRACE_MS"', () => {
      const configService = { get: jest.fn().mockReturnValue(undefined) };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      new ActivitySessionStore(configService as any);
      expect(configService.get).toHaveBeenCalledWith('WS_RECONNECT_GRACE_MS');
    });

    it('should return 0 from size immediately after construction', () => {
      store = makeActivitySessionStore();
      expect(store.size).toBe(0);
    });

    it('should return false from hasPendingGraceTimerForSession("any-session") immediately after construction', () => {
      store = makeActivitySessionStore();
      expect(store.hasPendingGraceTimerForSession('any-session')).toBe(false);
    });
  });

  // ── Phase 2: get() and has() ─────────────────────────────────────────────

  describe('get() and has()', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should return undefined from get() when the userId is unknown', () => {
      expect(store.get('unknown')).toBeUndefined();
    });

    it('should return false from has() when the userId is unknown', () => {
      expect(store.has('unknown')).toBe(false);
    });

    it('should return the stored ActivityState from get() after set()', () => {
      const state = makeActivityState();
      store.set('user-1', state);
      expect(store.get('user-1')).toBe(state);
    });

    it('should return true from has() after set() for the same userId', () => {
      store.set('user-1', makeActivityState());
      expect(store.has('user-1')).toBe(true);
    });
  });

  // ── Phase 3: set() ───────────────────────────────────────────────────────

  describe('set()', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should store the state and make it retrievable via get() when set() is called for a new userId', () => {
      const state = makeActivityState({ sessionId: 'session-abc' });
      store.set('user-1', state);
      expect(store.get('user-1')).toBe(state);
    });

    it('should overwrite the previous state when set() is called twice for the same userId', () => {
      const state1 = makeActivityState({ sessionId: 'session-1' });
      const state2 = makeActivityState({ sessionId: 'session-2' });
      store.set('user-1', state1);
      store.set('user-1', state2);
      expect(store.get('user-1')).toBe(state2);
    });

    it('should not start, cancel, or otherwise affect a pending grace timer when set() is called', () => {
      const cb = jest.fn();
      store.startGraceTimerForSession('session-1', cb);
      store.set('user-1', makeActivityState());

      expect(store.hasPendingGraceTimerForSession('session-1')).toBe(true);

      jest.advanceTimersByTime(1_000);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  // ── Phase 4: delete() ────────────────────────────────────────────────────

  describe('delete()', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should return true and remove the state from get()/has() when delete() is called for an existing userId', () => {
      store.set('user-1', makeActivityState());
      const result = store.delete('user-1');
      expect(result).toBe(true);
      expect(store.get('user-1')).toBeUndefined();
      expect(store.has('user-1')).toBe(false);
    });

    it('should return false when delete() is called for an unknown userId', () => {
      expect(store.delete('unknown')).toBe(false);
    });

    it('should not cancel a pending grace timer when delete() is called (timers are independent of state)', () => {
      const cb = jest.fn();
      store.set('user-1', makeActivityState({ sessionId: 'session-1' }));
      store.startGraceTimerForSession('session-1', cb);
      store.delete('user-1');

      expect(store.hasPendingGraceTimerForSession('session-1')).toBe(true);

      jest.advanceTimersByTime(1_000);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should leave hasPendingGraceTimerForSession(sessionB) unchanged when delete(userA) is called', () => {
      const cbB = jest.fn();
      store.set('user-a', makeActivityState({ sessionId: 'session-a' }));
      store.startGraceTimerForSession('session-b', cbB);

      store.delete('user-a');

      expect(store.hasPendingGraceTimerForSession('session-b')).toBe(true);
    });
  });

  // ── Phase 5: size getter ─────────────────────────────────────────────────

  describe('size getter', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should return 0 when no states are stored', () => {
      expect(store.size).toBe(0);
    });

    it('should increment by 1 after each set() for a new userId', () => {
      store.set('user-1', makeActivityState());
      expect(store.size).toBe(1);
      store.set('user-2', makeActivityState());
      expect(store.size).toBe(2);
    });

    it('should remain unchanged when set() overwrites an existing userId', () => {
      store.set('user-1', makeActivityState());
      expect(store.size).toBe(1);
      store.set('user-1', makeActivityState({ sessionId: 'session-2' }));
      expect(store.size).toBe(1);
    });

    it('should decrement by 1 after delete() removes an existing userId', () => {
      store.set('user-1', makeActivityState());
      store.set('user-2', makeActivityState());
      store.delete('user-1');
      expect(store.size).toBe(1);
    });

    it('should remain unchanged after delete() for an unknown userId', () => {
      store.set('user-1', makeActivityState());
      store.delete('unknown');
      expect(store.size).toBe(1);
    });
  });

  // Phase 6 (userId-keyed happy-path firing) removed:
  // Grace-period config assertions (default 30000ms, custom WS_RECONNECT_GRACE_MS)
  // are preserved by the rewritten constructor cases above.

  // ── Phase 6: startGraceTimerForSession() — replacing an existing timer ───

  describe('startGraceTimerForSession() — replacing an existing timer for the same sessionId', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should cancel the previous timer so its callback never fires when startGraceTimerForSession() is called twice for the same sessionId', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      store.startGraceTimerForSession('session-1', cb1);
      store.startGraceTimerForSession('session-1', cb2);

      jest.advanceTimersByTime(2_000);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('should fire only the most recent callback after graceMs elapses from the second startGraceTimerForSession() call', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      store.startGraceTimerForSession('session-1', cb1);
      jest.advanceTimersByTime(500); // halfway through first timer
      store.startGraceTimerForSession('session-1', cb2); // replaces; fires 1000ms from now

      jest.advanceTimersByTime(1_000);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Phase 7: startGraceTimerForSession() — post-expiry cleanup ──────────

  describe('startGraceTimerForSession() — post-expiry cleanup', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should remove the timer from the internal map after expiry so hasPendingGraceTimerForSession() returns false', () => {
      store.startGraceTimerForSession('session-1', jest.fn());
      jest.advanceTimersByTime(1_000);
      expect(store.hasPendingGraceTimerForSession('session-1')).toBe(false);
    });

    it('should allow a new grace timer to be started for the same sessionId after the previous one expired', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      store.startGraceTimerForSession('session-1', cb1);
      jest.advanceTimersByTime(1_000);

      store.startGraceTimerForSession('session-1', cb2);
      jest.advanceTimersByTime(1_000);

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Phase 8: startGraceTimerForSession() — Promise-returning callback (void semantics)

  describe('startGraceTimerForSession() — Promise-returning callback (void semantics)', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should invoke onExpiry exactly once and remove the timer entry when onExpiry returns a resolved Promise (after flushing microtasks)', async () => {
      const cb = jest.fn().mockResolvedValue(undefined);
      store.startGraceTimerForSession('session-1', cb);

      jest.advanceTimersByTime(1_000);
      await Promise.resolve(); // flush microtasks

      expect(cb).toHaveBeenCalledTimes(1);
      expect(store.hasPendingGraceTimerForSession('session-1')).toBe(false);
    });

    it('should not block subsequent timer scheduling for the same sessionId on the un-awaited Promise returned by onExpiry', async () => {
      const cb1 = jest.fn().mockResolvedValue(undefined);
      const cb2 = jest.fn();

      store.startGraceTimerForSession('session-1', cb1);
      jest.advanceTimersByTime(1_000);
      await Promise.resolve(); // flush microtasks

      // cb1 ran and the timer entry was removed — a new timer can be registered
      store.startGraceTimerForSession('session-1', cb2);
      jest.advanceTimersByTime(1_000);

      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // Phase 9 (userId-keyed concurrent independence) removed:
  // The firing-independence and expiry-independence invariants are covered by
  // 'should key grace timers by sessionId, not userId: two children expire independently'
  // in multi-session-lifecycle.spec.ts. The cancel-independence invariant is
  // carried forward below as part of cancelGraceTimerForSession().

  // ── Phase 9: cancelGraceTimerForSession() ───────────────────────────────

  describe('cancelGraceTimerForSession()', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should prevent the pending callback from firing when cancelGraceTimerForSession() is called before graceMs elapses', () => {
      const cb = jest.fn();
      store.startGraceTimerForSession('session-1', cb);
      store.cancelGraceTimerForSession('session-1');

      jest.advanceTimersByTime(1_000);
      expect(cb).not.toHaveBeenCalled();
    });

    it('should remove the timer entry so hasPendingGraceTimerForSession() returns false after cancelGraceTimerForSession()', () => {
      store.startGraceTimerForSession('session-1', jest.fn());
      store.cancelGraceTimerForSession('session-1');
      expect(store.hasPendingGraceTimerForSession('session-1')).toBe(false);
    });

    it('should be a no-op (no throw) when cancelGraceTimerForSession() is called for a sessionId with no pending timer', () => {
      expect(() => store.cancelGraceTimerForSession('session-1')).not.toThrow();
    });

    it('should not modify the stored ActivityState when cancelGraceTimerForSession() is called', () => {
      const state = makeActivityState();
      store.set('user-1', state);
      store.startGraceTimerForSession('session-1', jest.fn());
      store.cancelGraceTimerForSession('session-1');
      expect(store.get('user-1')).toBe(state);
    });

    it('should allow a new grace timer to be started for the same sessionId after cancelGraceTimerForSession()', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      store.startGraceTimerForSession('session-1', cb1);
      store.cancelGraceTimerForSession('session-1');
      store.startGraceTimerForSession('session-1', cb2);

      jest.advanceTimersByTime(1_000);

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it("should leave sessionB's pending timer intact when sessionA's timer is cancelled via cancelGraceTimerForSession()", () => {
      const cbA = jest.fn();
      const cbB = jest.fn();

      store.startGraceTimerForSession('session-a', cbA);
      store.startGraceTimerForSession('session-b', cbB);

      store.cancelGraceTimerForSession('session-a');

      expect(store.hasPendingGraceTimerForSession('session-b')).toBe(true);

      jest.advanceTimersByTime(1_000);
      expect(cbA).not.toHaveBeenCalled();
      expect(cbB).toHaveBeenCalledTimes(1);
    });
  });

  // ── Phase 10: hasPendingGraceTimerForSession() ──────────────────────────

  describe('hasPendingGraceTimerForSession()', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should return false when no timer has been started for the sessionId', () => {
      expect(store.hasPendingGraceTimerForSession('session-1')).toBe(false);
    });

    it('should return true immediately after startGraceTimerForSession() is called', () => {
      store.startGraceTimerForSession('session-1', jest.fn());
      expect(store.hasPendingGraceTimerForSession('session-1')).toBe(true);
    });

    it('should return false after the grace period elapses and the timer fires', () => {
      store.startGraceTimerForSession('session-1', jest.fn());
      jest.advanceTimersByTime(1_000);
      expect(store.hasPendingGraceTimerForSession('session-1')).toBe(false);
    });

    it('should return false after cancelGraceTimerForSession() is called', () => {
      store.startGraceTimerForSession('session-1', jest.fn());
      store.cancelGraceTimerForSession('session-1');
      expect(store.hasPendingGraceTimerForSession('session-1')).toBe(false);
    });

    it('should distinguish between different sessionIds (true for one, false for another)', () => {
      store.startGraceTimerForSession('session-1', jest.fn());
      expect(store.hasPendingGraceTimerForSession('session-1')).toBe(true);
      expect(store.hasPendingGraceTimerForSession('session-2')).toBe(false);
    });
  });
});
