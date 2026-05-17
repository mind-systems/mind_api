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

function makeActivityState(overrides: Partial<ActivityState> = {}): ActivityState {
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
      store.startGraceTimer('user-1', cb);

      jest.advanceTimersByTime(29_999);
      expect(cb).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should use the custom grace period from ConfigService when WS_RECONNECT_GRACE_MS is set', () => {
      store = makeActivitySessionStore(5_000);
      const cb = jest.fn();
      store.startGraceTimer('user-1', cb);

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

    it('should return false from hasPendingGraceTimer("any-user") immediately after construction', () => {
      store = makeActivitySessionStore();
      expect(store.hasPendingGraceTimer('any-user')).toBe(false);
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
      store.startGraceTimer('user-1', cb);
      store.set('user-1', makeActivityState());

      expect(store.hasPendingGraceTimer('user-1')).toBe(true);

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
      store.set('user-1', makeActivityState());
      store.startGraceTimer('user-1', cb);
      store.delete('user-1');

      expect(store.hasPendingGraceTimer('user-1')).toBe(true);

      jest.advanceTimersByTime(1_000);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should leave hasPendingGraceTimer(otherUser) unchanged when delete(userA) is called', () => {
      const cbB = jest.fn();
      store.set('user-a', makeActivityState());
      store.startGraceTimer('user-b', cbB);

      store.delete('user-a');

      expect(store.hasPendingGraceTimer('user-b')).toBe(true);
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

  // ── Phase 6: startGraceTimer() — happy path firing ───────────────────────

  describe('startGraceTimer() — happy path firing', () => {
    it('should invoke the onExpiry callback exactly once after the default grace period elapses (advance by graceMs)', () => {
      store = makeActivitySessionStore(undefined); // falls back to 30 000 ms
      const cb = jest.fn();
      store.startGraceTimer('user-1', cb);

      jest.advanceTimersByTime(30_000);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should invoke the onExpiry callback after the custom grace period when ConfigService returned a custom value', () => {
      store = makeActivitySessionStore(5_000);
      const cb = jest.fn();
      store.startGraceTimer('user-1', cb);

      jest.advanceTimersByTime(5_000);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should not invoke the onExpiry callback before the grace period elapses (advance by graceMs - 1)', () => {
      store = makeActivitySessionStore(5_000);
      const cb = jest.fn();
      store.startGraceTimer('user-1', cb);

      jest.advanceTimersByTime(4_999);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── Phase 7: startGraceTimer() — replacing an existing timer ─────────────

  describe('startGraceTimer() — replacing an existing timer for the same userId', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should cancel the previous timer so its callback never fires when startGraceTimer() is called twice for the same userId', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      store.startGraceTimer('user-1', cb1);
      store.startGraceTimer('user-1', cb2);

      jest.advanceTimersByTime(2_000);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('should fire only the most recent callback after graceMs elapses from the second startGraceTimer() call', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      store.startGraceTimer('user-1', cb1);
      jest.advanceTimersByTime(500); // halfway through first timer
      store.startGraceTimer('user-1', cb2); // replaces; fires 1000ms from now

      jest.advanceTimersByTime(1_000);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Phase 8: startGraceTimer() — post-expiry cleanup ─────────────────────

  describe('startGraceTimer() — post-expiry cleanup', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should remove the timer from the internal map after expiry so hasPendingGraceTimer() returns false', () => {
      store.startGraceTimer('user-1', jest.fn());
      jest.advanceTimersByTime(1_000);
      expect(store.hasPendingGraceTimer('user-1')).toBe(false);
    });

    it('should allow a new grace timer to be started for the same userId after the previous one expired', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      store.startGraceTimer('user-1', cb1);
      jest.advanceTimersByTime(1_000);

      store.startGraceTimer('user-1', cb2);
      jest.advanceTimersByTime(1_000);

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Phase 9: startGraceTimer() — Promise-returning callback (void semantics)

  describe('startGraceTimer() — Promise-returning callback (void semantics)', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should invoke onExpiry exactly once and remove the timer entry when onExpiry returns a resolved Promise (after flushing microtasks)', async () => {
      const cb = jest.fn().mockResolvedValue(undefined);
      store.startGraceTimer('user-1', cb);

      jest.advanceTimersByTime(1_000);
      await Promise.resolve(); // flush microtasks

      expect(cb).toHaveBeenCalledTimes(1);
      expect(store.hasPendingGraceTimer('user-1')).toBe(false);
    });

    it('should not block subsequent timer scheduling for the same userId on the un-awaited Promise returned by onExpiry', async () => {
      const cb1 = jest.fn().mockResolvedValue(undefined);
      const cb2 = jest.fn();

      store.startGraceTimer('user-1', cb1);
      jest.advanceTimersByTime(1_000);
      await Promise.resolve(); // flush microtasks

      // cb1 ran and the timer entry was removed — a new timer can be registered
      store.startGraceTimer('user-1', cb2);
      jest.advanceTimersByTime(1_000);

      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Phase 10: startGraceTimer() — concurrent independence between userIds ─

  describe('startGraceTimer() — concurrent independence between userIds', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should fire each userId\'s callback independently when concurrent timers are started for different userIds', () => {
      const cbA = jest.fn();
      const cbB = jest.fn();

      store.startGraceTimer('user-a', cbA);
      store.startGraceTimer('user-b', cbB);

      jest.advanceTimersByTime(1_000);

      expect(cbA).toHaveBeenCalledTimes(1);
      expect(cbB).toHaveBeenCalledTimes(1);
    });

    it('should leave userB\'s pending timer intact when userA\'s timer expires', () => {
      const cbA = jest.fn();
      const cbB = jest.fn();

      // userA's timer starts at t=0, fires at t=1000
      store.startGraceTimer('user-a', cbA);
      jest.advanceTimersByTime(500);
      // userB's timer starts at t=500, fires at t=1500
      store.startGraceTimer('user-b', cbB);

      jest.advanceTimersByTime(500); // now at t=1000: userA fires

      expect(cbA).toHaveBeenCalledTimes(1);
      expect(store.hasPendingGraceTimer('user-b')).toBe(true);
      expect(cbB).not.toHaveBeenCalled();
    });

    it('should leave userB\'s pending timer intact when userA\'s timer is cancelled via cancelGraceTimer()', () => {
      const cbA = jest.fn();
      const cbB = jest.fn();

      store.startGraceTimer('user-a', cbA);
      store.startGraceTimer('user-b', cbB);

      store.cancelGraceTimer('user-a');

      expect(store.hasPendingGraceTimer('user-b')).toBe(true);

      jest.advanceTimersByTime(1_000);
      expect(cbA).not.toHaveBeenCalled();
      expect(cbB).toHaveBeenCalledTimes(1);
    });
  });

  // ── Phase 11: cancelGraceTimer() ─────────────────────────────────────────

  describe('cancelGraceTimer()', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should prevent the pending callback from firing when cancelGraceTimer() is called before graceMs elapses', () => {
      const cb = jest.fn();
      store.startGraceTimer('user-1', cb);
      store.cancelGraceTimer('user-1');

      jest.advanceTimersByTime(1_000);
      expect(cb).not.toHaveBeenCalled();
    });

    it('should remove the timer entry so hasPendingGraceTimer() returns false after cancelGraceTimer()', () => {
      store.startGraceTimer('user-1', jest.fn());
      store.cancelGraceTimer('user-1');
      expect(store.hasPendingGraceTimer('user-1')).toBe(false);
    });

    it('should be a no-op (no throw) when cancelGraceTimer() is called for a userId with no pending timer', () => {
      expect(() => store.cancelGraceTimer('user-1')).not.toThrow();
    });

    it('should not modify the stored ActivityState when cancelGraceTimer() is called', () => {
      const state = makeActivityState();
      store.set('user-1', state);
      store.startGraceTimer('user-1', jest.fn());
      store.cancelGraceTimer('user-1');
      expect(store.get('user-1')).toBe(state);
    });

    it('should allow a new grace timer to be started for the same userId after cancelGraceTimer()', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      store.startGraceTimer('user-1', cb1);
      store.cancelGraceTimer('user-1');
      store.startGraceTimer('user-1', cb2);

      jest.advanceTimersByTime(1_000);

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Phase 12: hasPendingGraceTimer() ─────────────────────────────────────

  describe('hasPendingGraceTimer()', () => {
    beforeEach(() => {
      store = makeActivitySessionStore(1_000);
    });

    it('should return false when no timer has been started for the userId', () => {
      expect(store.hasPendingGraceTimer('user-1')).toBe(false);
    });

    it('should return true immediately after startGraceTimer() is called', () => {
      store.startGraceTimer('user-1', jest.fn());
      expect(store.hasPendingGraceTimer('user-1')).toBe(true);
    });

    it('should return false after the grace period elapses and the timer fires', () => {
      store.startGraceTimer('user-1', jest.fn());
      jest.advanceTimersByTime(1_000);
      expect(store.hasPendingGraceTimer('user-1')).toBe(false);
    });

    it('should return false after cancelGraceTimer() is called', () => {
      store.startGraceTimer('user-1', jest.fn());
      store.cancelGraceTimer('user-1');
      expect(store.hasPendingGraceTimer('user-1')).toBe(false);
    });

    it('should distinguish between different userIds (true for one, false for another)', () => {
      store.startGraceTimer('user-1', jest.fn());
      expect(store.hasPendingGraceTimer('user-1')).toBe(true);
      expect(store.hasPendingGraceTimer('user-2')).toBe(false);
    });
  });
});
