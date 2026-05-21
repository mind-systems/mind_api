import { Subscriber } from 'rxjs';
import { ActiveStreamRegistry } from './active-stream-registry.service';

function makeSubscriber(): Subscriber<any> {
  return new Subscriber<any>();
}

describe('ActiveStreamRegistry', () => {
  let registry: ActiveStreamRegistry;

  beforeEach(() => {
    registry = new ActiveStreamRegistry();
  });

  // ──────────────────────────────────────────────
  // Phase 1: Initial state and register()
  // ──────────────────────────────────────────────

  describe('initial state', () => {
    it('should report size 0 when newly instantiated', () => {
      expect(registry.size).toBe(0);
    });
  });

  describe('register()', () => {
    it('should create a new Set and add the subscriber when registering the first subscriber for a userId', () => {
      const sub = makeSubscriber();
      registry.register('user1', sub);
      expect(registry.size).toBe(1);
    });

    it('should add a second subscriber to the same userId without replacing the first when registering twice for one user', () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      registry.register('user1', sub1);
      registry.register('user1', sub2);
      expect(registry.size).toBe(2);
    });

    it('should keep separate Sets per user when registering subscribers for multiple userIds', () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      registry.register('user1', sub1);
      registry.register('user2', sub2);
      expect(registry.size).toBe(2);

      // Closing user1 should not affect user2's entry
      registry.closeAll('user1');
      expect(registry.size).toBe(1);
    });

    it('should be idempotent when the same subscriber reference is registered twice for the same userId', () => {
      const sub = makeSubscriber();
      registry.register('user1', sub);
      registry.register('user1', sub);
      expect(registry.size).toBe(1);
    });
  });

  // ──────────────────────────────────────────────
  // Phase 2: deregister()
  // ──────────────────────────────────────────────

  describe('deregister()', () => {
    it('should remove the subscriber and decrease size when deregistering a known subscriber', () => {
      const sub = makeSubscriber();
      registry.register('user1', sub);
      registry.deregister('user1', sub);
      expect(registry.size).toBe(0);
    });

    it("should delete the user's Set entirely when its last subscriber is deregistered", () => {
      const sub = makeSubscriber();
      registry.register('user1', sub);
      registry.deregister('user1', sub);

      // A fresh register after full deletion should work normally
      const sub2 = makeSubscriber();
      registry.register('user1', sub2);
      expect(registry.size).toBe(1);
    });

    it('should be a no-op when called with an unknown userId', () => {
      expect(() =>
        registry.deregister('ghost', makeSubscriber()),
      ).not.toThrow();
      expect(registry.size).toBe(0);
    });

    it('should be a no-op when called with a subscriber that was never registered for that userId', () => {
      const registered = makeSubscriber();
      const stranger = makeSubscriber();
      registry.register('user1', registered);
      registry.deregister('user1', stranger);
      expect(registry.size).toBe(1);
    });

    it("should not affect other users' Sets when deregistering a subscriber for one userId", () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      registry.register('user1', sub1);
      registry.register('user2', sub2);

      registry.deregister('user1', sub1);
      expect(registry.size).toBe(1);
    });
  });

  // ──────────────────────────────────────────────
  // Phase 3: closeAll()
  // ──────────────────────────────────────────────

  describe('closeAll()', () => {
    it('should call complete() on every subscriber for the given userId', () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      const spy1 = jest.spyOn(sub1, 'complete');
      const spy2 = jest.spyOn(sub2, 'complete');

      registry.register('user1', sub1);
      registry.register('user1', sub2);
      registry.closeAll('user1');

      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);
    });

    it("should delete the user's Set after completing all subscribers", () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      registry.register('user1', sub1);
      registry.register('user1', sub2);
      registry.closeAll('user1');

      expect(registry.size).toBe(0);
      // Subsequent closeAll for same user is a no-op
      expect(() => registry.closeAll('user1')).not.toThrow();
    });

    it('should be a no-op when called with an unknown userId', () => {
      const otherSub = makeSubscriber();
      const spy = jest.spyOn(otherSub, 'complete');
      registry.register('user2', otherSub);

      expect(() => registry.closeAll('ghost')).not.toThrow();
      expect(spy).not.toHaveBeenCalled();
      expect(registry.size).toBe(1);
    });

    it('should not call complete() on subscribers belonging to other userIds when closing one user', () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      const spy2 = jest.spyOn(sub2, 'complete');

      registry.register('user1', sub1);
      registry.register('user2', sub2);
      registry.closeAll('user1');

      expect(spy2).not.toHaveBeenCalled();
    });

    it("should not affect other users' entries in the registry when closing one user", () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      registry.register('user1', sub1);
      registry.register('user2', sub2);
      registry.closeAll('user1');

      expect(registry.size).toBe(1);
    });
  });

  // ──────────────────────────────────────────────
  // Phase 4: size getter
  // ──────────────────────────────────────────────

  describe('size getter', () => {
    it('should return the sum of subscribers across all users (not the number of users)', () => {
      registry.register('user1', makeSubscriber());
      registry.register('user1', makeSubscriber());
      registry.register('user1', makeSubscriber());
      registry.register('user2', makeSubscriber());
      registry.register('user2', makeSubscriber());

      expect(registry.size).toBe(5);
    });

    it('should decrease by 1 when one subscriber is deregistered', () => {
      const sub = makeSubscriber();
      registry.register('user1', sub);
      registry.register('user1', makeSubscriber());
      expect(registry.size).toBe(2);

      registry.deregister('user1', sub);
      expect(registry.size).toBe(1);
    });

    it("should return 0 after closeAll removes the last user's Set", () => {
      const sub = makeSubscriber();
      registry.register('user1', sub);
      registry.closeAll('user1');

      expect(registry.size).toBe(0);
    });
  });

  // ──────────────────────────────────────────────
  // Phase 5: onModuleDestroy()
  // ──────────────────────────────────────────────

  describe('onModuleDestroy()', () => {
    it('should call complete() on every subscriber across all users', () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      const sub3 = makeSubscriber();
      const spy1 = jest.spyOn(sub1, 'complete');
      const spy2 = jest.spyOn(sub2, 'complete');
      const spy3 = jest.spyOn(sub3, 'complete');

      registry.register('user1', sub1);
      registry.register('user1', sub2);
      registry.register('user2', sub3);

      registry.onModuleDestroy();

      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);
      expect(spy3).toHaveBeenCalledTimes(1);
    });

    it('should leave size === 0 after destruction', () => {
      registry.register('user1', makeSubscriber());
      registry.register('user2', makeSubscriber());
      registry.onModuleDestroy();

      expect(registry.size).toBe(0);
    });

    it('should be safe to call on an empty registry', () => {
      expect(() => registry.onModuleDestroy()).not.toThrow();
      expect(registry.size).toBe(0);
    });

    it('should allow new register() calls to work normally after onModuleDestroy()', () => {
      registry.register('user1', makeSubscriber());
      registry.onModuleDestroy();

      const fresh = makeSubscriber();
      registry.register('user1', fresh);
      expect(registry.size).toBe(1);
    });
  });
});
