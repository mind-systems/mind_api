# Code Review — Per-service last-connect-wins stream eviction + CONNECTION_SUPERSEDED + supersede-children takeover

**Branch:** `feature/root-session`
**Scope reviewed:** full `git diff HEAD` + surrounding code of every changed file. TypeScript typecheck of the changed files is clean (the pre-existing `biometric-stream-engine.service.spec.ts` `TS2352` errors are unrelated — that file is not in this diff). All 228 tests across the six changed spec files pass.

---

## Finding 1 — CONFIRMED, HIGH — `register()` detaches the new subscriber from the registry when the evicted subscriber is the last entry for that user

**File:** `src/realtime/services/active-stream-registry.service.ts:19-38` (`register`)

### The defect
`register` captures `serviceMap` **before** the eviction, then reuses that stale reference to store the new subscriber **after** `existing.complete()`:

```ts
let serviceMap = this.streams.get(userId);      // (M) device A's inner map
if (!serviceMap) { serviceMap = new Map(); this.streams.set(userId, serviceMap); }
const existing = serviceMap.get(service);
if (existing && existing !== subscriber) {
  this.evictedSubscribers.add(existing);
  onEvict?.(existing);
  existing.complete();          // ← synchronously runs device A's teardown → deregister
}
serviceMap.set(service, subscriber);   // ← writes into M, which may now be DETACHED
```

In production every controller attaches `subscriber.add(() => registry.deregister(userId, service, subscriber))`, so `existing.complete()` runs `deregister` **synchronously**. `deregister` does:

```ts
serviceMap.delete(service);
if (serviceMap.size === 0) this.streams.delete(userId);   // prunes the userId key
```

When the evicted subscriber is the **last** entry in that user's inner map, `deregister` removes the `userId` key from `this.streams` entirely. Control returns to `register`, which then calls `serviceMap.set(service, subscriber)` on the now-**orphaned** map `M` that `this.streams` no longer references. The new subscriber is therefore **invisible** to the registry: `this.streams.get(userId)` is `undefined`.

The spec's §Safety step 5 ("register stores the new subscriber into the momentarily-empty slot") overlooks that `deregister` prunes the whole `userId` key when the inner map empties — so the bug is inherited verbatim from the pinned spec §2 code block, not introduced by the implementer.

### Why the tests miss it
The registry unit test (`active-stream-registry.service.spec.ts:33-41`) asserts `size === 1` after eviction, but it uses bare `makeSubscriber()` objects with **no** `subscriber.add(deregister)` teardown. So `sub1.complete()` there does nothing to the map, `serviceMap` stays attached, and the test passes. The teardown that triggers the pruning only exists on the real controller subscribers.

### Reproduction (run against the real registry with a controller-style teardown)
```ts
const reg = new ActiveStreamRegistry();
const make = () => { const s = new Subscriber<any>();
  s.add(() => reg.deregister('u', StreamService.STATE, s)); return s; };
reg.register('u', StreamService.STATE, make());        // devA
reg.register('u', StreamService.STATE, make());        // devB evicts devA
// EXPECTED: size 1, hasLiveSubscriber true
// ACTUAL:   size 0, hasLiveSubscriber('u') === false   ← devB lost
```
Verified: prints `size after eviction = 0`, `hasLiveSubscriber(userA) = false`.

### Failure scenario / production impact
Triggers whenever the evicted STATE subscriber is the last remaining entry in that user's inner service map at eviction time — e.g. a two-device STATE takeover where the other three streams (bio/instruction/sync) are not concurrently registered under that user, any connect ordering where the other services are evicted first, or any single-service consumer (a client that opens only the state stream). Once device B is detached:

1. **The watchdog abandons the taken-over session.** `session-watchdog.service.ts:80,117` skips reaping only when `hasLiveSubscriber(userId)` is true. With device B detached it returns `false`, so `abandonStale` + `closeAll` reap the session device B just inherited (`session-watchdog.service.ts:89-92`).
2. **The single-session / anti-ping-pong guarantee breaks.** A later device C connecting for STATE finds an empty slot → no eviction → no `CONNECTION_SUPERSEDED` frame and no `supersedeChildren` → two live STATE streams coexist, which is exactly the state this feature exists to prevent.
3. **Device B's own teardown misroutes.** Its later `deregister` finds no attached map, returns `wasEvicted = false`, and calls `handleTransportDisconnect` on a connection that was never a genuine drop.

### Suggested fix
Re-resolve the inner map **after** the eviction, immediately before storing:

```ts
register(userId, service, subscriber, onEvict?) {
  const existing = this.streams.get(userId)?.get(service);
  if (existing && existing !== subscriber) {
    this.evictedSubscribers.add(existing);
    onEvict?.(existing);
    existing.complete();               // may prune this.streams[userId]
  }
  let serviceMap = this.streams.get(userId);   // re-fetch — the prior ref may be detached
  if (!serviceMap) { serviceMap = new Map(); this.streams.set(userId, serviceMap); }
  serviceMap.set(service, subscriber);
}
```

Add a regression test that attaches a `deregister` teardown to the evicted subscriber (mirroring the controllers) and asserts `size === 1` / `hasLiveSubscriber === true` / that a third register still evicts, since the current unit test's bare subscribers cannot catch this class of bug.

---

## Items checked and cleared

- **Race-safety of `supersedeChildren` (spec §Safety-2).** The store is cleared in a synchronous first loop (`removeChild`) before the first `await` in the second loop; `handleReconnect` reads `listChildren` synchronously at its top (`activity-engine.service.ts:616-618`) before its first `await`. Since children are removed from the store before any yield, `handleReconnect` sees zero children and `supersedeChildren`'s DB writes touch only child rows while `handleReconnect` touches only the root row — no row-level conflict. Correct.
- **`INTERRUPTED` event/marker payload.** `supersedeChildren`'s `pushSessionEventMarker` + `eventEmitter.emit(SessionEvents.INTERRUPTED, …)` payload is byte-identical to `stopActivity` (`activity-engine.service.ts:459-475`); the `@OnEvent(SessionEvents.INTERRUPTED)` consumer in `biometric-stream-engine.service.ts:228` handles it unchanged.
- **Root untouched.** `supersedeChildren` only enumerates `listChildren` (excludes root) and never calls `removeRoot`/touches `getRoot`. Root stays `ACTIVE` for the new stream's reconnect.
- **`wasEvicted` teardown branch.** Genuine-drop path (`else`) is byte-for-byte the pre-change `handleTransportDisconnect` call; `rateLimiterService.evict`/`idempotency.evictUser` remain unconditional and last. Matches spec §5.
- **`closeAll` / `onModuleDestroy` do not mark evicted.** Confirmed — they call `subscriber.complete()` without touching `evictedSubscribers`, so revocation/shutdown teardown reports `wasEvicted = false` → `handleTransportDisconnect`, unchanged. `handleSessionRevoked` (`module-state.grpc.controller.ts:294-310`) stops children then `closeAll`, unaffected.
- **Missing grace-timer cancellation in `supersedeChildren` is not reachable.** A child can only have an armed grace timer after `handleTransportDisconnect` ran for that connection, which only happens post-`deregister`; an evicted STATE subscriber is by definition still live in the registry, so its children are `ACTIVE` with no pending timer. No stray abandon.
- **Controller wiring.** All four controllers pass the correct `StreamService` key on both `register` and `deregister`; only STATE passes `onEvict`. The adjacent `syncStreamService.deregister(userId, pushFn)` (a different service) is untouched. `closeAll`/`hasLiveSubscriber` keep their original `userId`-only signatures at all call sites.
- **`CONNECTION_SUPERSEDED` frame shape.** Uses the existing `StateErrorEvent` `{ code, message, timestamp }` with a plain literal code (same precedent as `CANNOT_END_ROOT`); no proto change. Ordering (`next` before `complete`) is enforced by `register` and covered by `active-stream-registry.service.spec.ts:95-126`.

---

Fix Finding 1 before merge — it defeats the core single-session guarantee this milestone ships and can cause the watchdog to abandon a live taken-over session. The correction also belongs upstream in spec `47-per-service-stream-eviction.md` §2/§Safety, whose pinned code block carries the same defect.
