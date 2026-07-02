import { Subscriber } from 'rxjs';
import { ActiveStreamRegistry } from './active-stream-registry.service';
import { StreamService } from '../constants/stream-service';

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
      registry.register('user1', StreamService.STATE, sub);
      expect(registry.size).toBe(1);
    });

    it('should evict (complete) the prior subscriber when registering a second one for the same (userId, service)', () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      const spy1 = jest.spyOn(sub1, 'complete');
      registry.register('user1', StreamService.STATE, sub1);
      registry.register('user1', StreamService.STATE, sub2);
      expect(spy1).toHaveBeenCalledTimes(1);
      expect(registry.size).toBe(1);
    });

    it('should keep both subscribers live when registering for different services under the same userId', () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      const spy1 = jest.spyOn(sub1, 'complete');
      const spy2 = jest.spyOn(sub2, 'complete');
      registry.register('user1', StreamService.STATE, sub1);
      registry.register('user1', StreamService.INSTRUCTION, sub2);
      expect(registry.size).toBe(2);
      expect(spy1).not.toHaveBeenCalled();
      expect(spy2).not.toHaveBeenCalled();
    });

    it('should keep separate Sets per user when registering subscribers for multiple userIds', () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub1);
      registry.register('user2', StreamService.STATE, sub2);
      expect(registry.size).toBe(2);

      // Closing user1 should not affect user2's entry
      registry.closeAll('user1');
      expect(registry.size).toBe(1);
    });

    it('should invoke the optional onEvict callback with the evicted subscriber before calling complete() on it', () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      const completeSpy = jest.spyOn(sub1, 'complete');
      const onEvict = jest.fn(() => {
        expect(completeSpy).not.toHaveBeenCalled(); // onEvict must run BEFORE complete()
      });
      registry.register('user1', StreamService.STATE, sub1);
      registry.register('user1', StreamService.STATE, sub2, onEvict);
      expect(onEvict).toHaveBeenCalledWith(sub1);
      expect(completeSpy).toHaveBeenCalledTimes(1);
    });

    it('should not invoke onEvict when there is nothing to evict', () => {
      const sub1 = makeSubscriber();
      const onEvict = jest.fn();
      registry.register('user1', StreamService.STATE, sub1, onEvict);
      expect(onEvict).not.toHaveBeenCalled();
    });

    it('should not invoke onEvict when re-registering the identical subscriber', () => {
      const sub = makeSubscriber();
      const onEvict = jest.fn();
      registry.register('user1', StreamService.STATE, sub);
      registry.register('user1', StreamService.STATE, sub, onEvict);
      expect(onEvict).not.toHaveBeenCalled();
    });

    it('should emit session_error CONNECTION_SUPERSEDED then complete, in that order, on STATE eviction', () => {
      const evicted = makeSubscriber();
      const nextSpy = jest.spyOn(evicted, 'next');
      const completeSpy = jest.spyOn(evicted, 'complete');
      const newSub = makeSubscriber();

      // Mirrors the exact onEvict shape module-state.grpc.controller.ts wires (§7 of note 47) —
      // the registry itself is generic and knows nothing about StateErrorEvent; this callback
      // is what a real STATE register() call would pass.
      const onEvict = (sub: typeof evicted) =>
        sub.next({
          sessionError: {
            code: 'CONNECTION_SUPERSEDED',
            message: 'Superseded by a new connection',
            timestamp: Date.now(),
          },
        });

      registry.register('user1', StreamService.STATE, evicted);
      registry.register('user1', StreamService.STATE, newSub, onEvict);

      expect(nextSpy).toHaveBeenCalledWith({
        sessionError: expect.objectContaining({
          code: 'CONNECTION_SUPERSEDED',
        }),
      });
      expect(completeSpy).toHaveBeenCalledTimes(1);
      // Ordering: next() must be the call that happened first among the two spies.
      expect(nextSpy.mock.invocationCallOrder[0]).toBeLessThan(
        completeSpy.mock.invocationCallOrder[0],
      );
    });

    it('should keep the new subscriber live when the evicted subscriber is the last entry and its teardown synchronously deregisters (mirrors real controller wiring)', () => {
      const makeWithTeardown = (service: StreamService) => {
        const sub = makeSubscriber();
        sub.add(() => registry.deregister('user1', service, sub));
        return sub;
      };

      const sub1 = makeWithTeardown(StreamService.STATE);
      registry.register('user1', StreamService.STATE, sub1);

      const sub2 = makeWithTeardown(StreamService.STATE);
      registry.register('user1', StreamService.STATE, sub2);

      expect(registry.size).toBe(1);
      expect(registry.hasLiveSubscriber('user1')).toBe(true);

      // A third register must still evict sub2 (proves sub2 is actually tracked).
      const sub3 = makeSubscriber();
      const spy2 = jest.spyOn(sub2, 'complete');
      registry.register('user1', StreamService.STATE, sub3);
      expect(spy2).toHaveBeenCalledTimes(1);
      expect(registry.size).toBe(1);
    });

    it('should be idempotent when the same subscriber reference is registered twice for the same userId', () => {
      const sub = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub);
      const completeSpy = jest.spyOn(sub, 'complete');
      registry.register('user1', StreamService.STATE, sub);
      expect(registry.size).toBe(1);
      expect(completeSpy).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // Phase 2: deregister()
  // ──────────────────────────────────────────────

  describe('deregister()', () => {
    it('should remove the subscriber and decrease size when deregistering a known subscriber', () => {
      const sub = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub);
      registry.deregister('user1', StreamService.STATE, sub);
      expect(registry.size).toBe(0);
    });

    it("should delete the user's Set entirely when its last subscriber is deregistered", () => {
      const sub = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub);
      registry.deregister('user1', StreamService.STATE, sub);

      // A fresh register after full deletion should work normally
      const sub2 = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub2);
      expect(registry.size).toBe(1);
    });

    it('should be a no-op when called with an unknown userId', () => {
      expect(() =>
        registry.deregister('ghost', StreamService.STATE, makeSubscriber()),
      ).not.toThrow();
      expect(registry.size).toBe(0);
    });

    it('should be a no-op when called with a subscriber that was never registered for that userId', () => {
      const registered = makeSubscriber();
      const stranger = makeSubscriber();
      registry.register('user1', StreamService.STATE, registered);
      registry.deregister('user1', StreamService.STATE, stranger);
      expect(registry.size).toBe(1);
    });

    it("should not affect other users' Sets when deregistering a subscriber for one userId", () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub1);
      registry.register('user2', StreamService.STATE, sub2);

      registry.deregister('user1', StreamService.STATE, sub1);
      expect(registry.size).toBe(1);
    });

    it('should not mark a subscriber as evicted when it is registered, deregistered, then a fresh subscriber registers for the same slot', () => {
      const sub = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub);
      expect(registry.deregister('user1', StreamService.STATE, sub)).toBe(
        false,
      );

      const fresh = makeSubscriber();
      registry.register('user1', StreamService.STATE, fresh);
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

      registry.register('user1', StreamService.STATE, sub1);
      registry.register('user1', StreamService.INSTRUCTION, sub2);
      registry.closeAll('user1');

      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);
    });

    it("should delete the user's Set after completing all subscribers", () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub1);
      registry.register('user1', StreamService.INSTRUCTION, sub2);
      registry.closeAll('user1');

      expect(registry.size).toBe(0);
      // Subsequent closeAll for same user is a no-op
      expect(() => registry.closeAll('user1')).not.toThrow();
    });

    it('should be a no-op when called with an unknown userId', () => {
      const otherSub = makeSubscriber();
      const spy = jest.spyOn(otherSub, 'complete');
      registry.register('user2', StreamService.STATE, otherSub);

      expect(() => registry.closeAll('ghost')).not.toThrow();
      expect(spy).not.toHaveBeenCalled();
      expect(registry.size).toBe(1);
    });

    it('should not call complete() on subscribers belonging to other userIds when closing one user', () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      const spy2 = jest.spyOn(sub2, 'complete');

      registry.register('user1', StreamService.STATE, sub1);
      registry.register('user2', StreamService.STATE, sub2);
      registry.closeAll('user1');

      expect(spy2).not.toHaveBeenCalled();
    });

    it("should not affect other users' entries in the registry when closing one user", () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub1);
      registry.register('user2', StreamService.STATE, sub2);
      registry.closeAll('user1');

      expect(registry.size).toBe(1);
    });

    it('should NOT mark a subscriber as evicted when it is completed via closeAll', () => {
      const sub = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub);
      registry.closeAll('user1');
      expect(registry.deregister('user1', StreamService.STATE, sub)).toBe(
        false,
      );
    });
  });

  // ──────────────────────────────────────────────
  // Phase 4: size getter
  // ──────────────────────────────────────────────

  describe('size getter', () => {
    it('should return the sum of subscribers across all users (not the number of users)', () => {
      registry.register('user1', StreamService.STATE, makeSubscriber());
      registry.register('user1', StreamService.INSTRUCTION, makeSubscriber());
      registry.register('user1', StreamService.BIO, makeSubscriber());
      registry.register('user2', StreamService.STATE, makeSubscriber());
      registry.register('user2', StreamService.INSTRUCTION, makeSubscriber());

      expect(registry.size).toBe(5);
    });

    it('should decrease by 1 when one subscriber is deregistered', () => {
      const sub = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub);
      registry.register('user1', StreamService.INSTRUCTION, makeSubscriber());
      expect(registry.size).toBe(2);

      registry.deregister('user1', StreamService.STATE, sub);
      expect(registry.size).toBe(1);
    });

    it("should return 0 after closeAll removes the last user's Set", () => {
      const sub = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub);
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

      registry.register('user1', StreamService.STATE, sub1);
      registry.register('user1', StreamService.INSTRUCTION, sub2);
      registry.register('user2', StreamService.STATE, sub3);

      registry.onModuleDestroy();

      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);
      expect(spy3).toHaveBeenCalledTimes(1);
    });

    it('should leave size === 0 after destruction', () => {
      registry.register('user1', StreamService.STATE, makeSubscriber());
      registry.register('user2', StreamService.STATE, makeSubscriber());
      registry.onModuleDestroy();

      expect(registry.size).toBe(0);
    });

    it('should be safe to call on an empty registry', () => {
      expect(() => registry.onModuleDestroy()).not.toThrow();
      expect(registry.size).toBe(0);
    });

    it('should allow new register() calls to work normally after onModuleDestroy()', () => {
      registry.register('user1', StreamService.STATE, makeSubscriber());
      registry.onModuleDestroy();

      const fresh = makeSubscriber();
      registry.register('user1', StreamService.STATE, fresh);
      expect(registry.size).toBe(1);
    });

    it('should NOT mark a subscriber as evicted when it is completed via onModuleDestroy', () => {
      const sub = makeSubscriber();
      registry.register('user1', StreamService.STATE, sub);
      registry.onModuleDestroy();
      expect(registry.deregister('user1', StreamService.STATE, sub)).toBe(
        false,
      );
    });
  });

  // ──────────────────────────────────────────────
  // Phase 6: supersede-signal reachability guards (A6)
  // ──────────────────────────────────────────────

  describe('eviction reachability guards', () => {
    it('should evict via a bare complete() with no session_error when no onEvict argument is supplied', () => {
      const sub1 = makeSubscriber();
      const sub2 = makeSubscriber();
      const nextSpy = jest.spyOn(sub1, 'next');
      const completeSpy = jest.spyOn(sub1, 'complete');

      registry.register('user1', StreamService.BIO, sub1);
      registry.register('user1', StreamService.BIO, sub2);

      expect(completeSpy).toHaveBeenCalledTimes(1);
      expect(nextSpy).not.toHaveBeenCalled();
    });
  });
});
