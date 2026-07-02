# Tests: per-service stream eviction + takeover-not-abandon

**Date:** 2026-07-02
**Source:** conversation context (product decision — single-session engine, last-connect-wins)

Companion test task — TDD-first, lands **before** [[47-per-service-stream-eviction]]. Edits three committed spec files (`active-stream-registry.service.spec.ts`, `module-state.grpc.controller.spec.ts`, `activity-engine.service.spec.ts`) — a new task, never an edit to the frozen tasks that produced them.

## Scope
Covers three parts of [[47-per-service-stream-eviction]]: **Part A** (`active-stream-registry.service.spec.ts`) — the registry's own per-`(userId, service)` eviction mechanics, the new optional `onEvict` pre-complete hook, an end-to-end `session_error{CONNECTION_SUPERSEDED}`-then-`complete()` ordering proof against the real registry, and guards that the supersede signal is unreachable from `closeAll`/`onModuleDestroy` or from a service that passes no `onEvict` (A6); **Part B** (`module-state.grpc.controller.spec.ts`) — the state controller's takeover branching (eviction → `supersedeChildren`, never `handleTransportDisconnect`; genuine drop → `handleTransportDisconnect` unchanged) and the `onEvict` callback wiring that pushes `CONNECTION_SUPERSEDED`; **Part C** (`activity-engine.service.spec.ts`) — the new `ActivityEngine.supersedeChildren` method itself: ends every child (terminal `INTERRUPTED` status, `endedAt` set — not `disconnectedAt`), leaves the root untouched and `ACTIVE` (same in-memory reference, never persisted), and clears the store synchronously (the load-bearing race-safety property).

## Grounded finding — a mechanical service-arg insertion is NOT safe everywhere
`register`/`deregister` widen from `(userId, subscriber)` to `(userId, service, subscriber)`. Naively inserting the **same** `StreamService` literal into every existing call would silently corrupt several committed cases that register **the same userId twice** expecting **both** subscribers to coexist — under the new design, two registers for the same `(userId, service)` now **evict** the first. Each such case is enumerated below with the precise fix (use two **different** services, not a uniform literal). This is exactly the kind of trap that costs extra rounds if not caught before authoring — verified by reading every call site, not assumed.

## Part A — `active-stream-registry.service.spec.ts`

### A1. Genuine anti-target — split, by file:line
**`:32-38`** — `it('should add a second subscriber to the same userId without replacing the first when registering twice for one user')`: `register('user1', sub1)`, `register('user1', sub2)`, asserts `size === 2`. This is the **only** case asserting the now-wrong "no eviction" behavior. Split into two:
- **NEW TARGET (RED until [[47-per-service-stream-eviction]]):** "should evict (complete) the prior subscriber when registering a second one for the same (userId, service)" — `const spy1 = jest.spyOn(sub1, 'complete'); registry.register('user1', StreamService.STATE, sub1); registry.register('user1', StreamService.STATE, sub2);` → assert `spy1` called once, `registry.size === 1`. RED today: `register` has no `service` param (compile-level) and performs no eviction (`size` would be 2, `complete()` never called).
- **REWRITTEN CHARACTERIZATION** (preserves the original test's intent — one user, multiple concurrent streams — correctly rescoped to cross-service): "should keep both subscribers live when registering for different services under the same userId" — `register('user1', StreamService.STATE, sub1)`, `register('user1', StreamService.INSTRUCTION, sub2)` → assert `size === 2`, neither `.complete()` called.

### A1b. New target — `onEvict` callback fires before `complete()`
Registry-level, independent of any controller: "should invoke the optional onEvict callback with the evicted subscriber before calling complete() on it" —
```ts
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
```
RED until [[47-per-service-stream-eviction]]: `register` has no 4th parameter today (compile-level) and never fires eviction. **Characterization, add alongside:** "should not invoke onEvict when there is nothing to evict" (first-ever register for a slot, `onEvict` passed but never called) and "should not invoke onEvict when re-registering the identical subscriber" (idempotent path, ties to A2).

### A1c. New target — end-to-end frame ordering with the real STATE-shaped `onEvict` (closes the "assert error-then-complete" gap)
A1b proves generic ordering (a bare `jest.fn()` runs before `complete()`); it does **not** exercise the actual `session_error` **content** the STATE controller pushes, nor assert `next()` and `complete()` fire on the **same** evicted subscriber in one flowing sequence — that combined proof belongs here, against the **real** registry (Part A has no mocking layer between the test and the code under test, unlike Part B's mocked-registry controller spec):
```ts
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
    sessionError: expect.objectContaining({ code: 'CONNECTION_SUPERSEDED' }),
  });
  expect(completeSpy).toHaveBeenCalledTimes(1);
  // Ordering: next() must be the call that happened first among the two spies.
  expect(nextSpy.mock.invocationCallOrder[0]).toBeLessThan(
    completeSpy.mock.invocationCallOrder[0],
  );
});
```
RED until [[47-per-service-stream-eviction]]: `register` has no 4th parameter and performs no eviction — `nextSpy`/`completeSpy` are never called. This is the case that directly answers "does eviction of the STATE stream emit `session_error{code:'CONNECTION_SUPERSEDED'}` before the graceful complete" — Part B's B4 (below) only proves the controller **wires** the right callback shape via a simulated invocation; this A1c case proves the registry actually **sequences** it correctly end-to-end.

### A2. Strengthen, stays GREEN (mechanical + one added assertion)
**`:52-57`** — `it('should be idempotent when the same subscriber reference is registered twice for the same userId')`: `register('user1', sub)` twice with the **identical** subscriber object. Add the `service` arg (`StreamService.STATE` both calls) — stays `size === 1` (the reference-equality guard in `register` must skip eviction when `existing === subscriber`). **Add** `expect(jest.spyOn(sub, 'complete')).not.toHaveBeenCalled()` (spy set up before the second register) — this now exercises a materially different code path (an explicit identity check, not implicit `Set` dedup) and is the guard against a self-eviction footgun; make the assertion explicit rather than implied.

### A3. Rewrite required — same-userId multi-register cases that would silently break
These register the **same userId** more than once and assert a **combined count/behavior across all of them** — mechanically applying one uniform service literal would collapse them via eviction and either fail loudly (good) or, worse, **pass for the wrong reason** (a spy already satisfied by the eviction step, not by the code path under test). Fix: assign each same-user registration a **distinct** `StreamService` (four available: `STATE`, `INSTRUCTION`, `BIO`, `SYNC`).
- **`:114-126`** (`closeAll()` → `'should call complete() on every subscriber for the given userId'`) — registers `user1` twice (`sub1`, `sub2`). Rewrite to `register('user1', StreamService.STATE, sub1)`, `register('user1', StreamService.INSTRUCTION, sub2)` so both are live when `closeAll('user1')` runs — otherwise `sub1` is evicted (and its `complete()` spy satisfied) during registration itself, never by `closeAll`, and the test would pass while proving the wrong thing.
- **`:128-138`** (`'should delete the user's Set after completing all subscribers'`) — same pattern; same fix (two distinct services for `user1`'s two registrations).
- **`:178-186`** (`size getter` → `'should return the sum of subscribers across all users'`) — registers `user1` **three** times and `user2` **twice**, expects `size === 5`. Rewrite `user1`'s three registrations to `STATE`/`INSTRUCTION`/`BIO` and `user2`'s two to `STATE`/`INSTRUCTION` — otherwise same-user repeats collapse via eviction and the actual sum would be `2` (one surviving slot per user), not `5`.
- **`:188-196`** (`'should decrease by 1 when one subscriber is deregistered'`) — registers `user1` twice (`sub`, then an anonymous second), expects `size === 2` before deregistering `sub`. Rewrite the two `user1` registrations to distinct services (e.g. `STATE` for `sub`, `INSTRUCTION` for the second) — otherwise the second register evicts `sub` before the test ever calls `deregister` on it, and `deregister('user1', sub)` becomes a no-op against an already-evicted subscriber (the defensive occupant-identity check in `deregister` finds no match) — the final assertion could coincidentally read `1` for the wrong reason while the intermediate `size === 2` assertion fails loudly.
- **`:212-229`** (`onModuleDestroy()` → `'should call complete() on every subscriber across all users'`) — registers `user1` twice (`sub1`, `sub2`) + `user2` once (`sub3`), asserts all three spies called once via `onModuleDestroy`. Rewrite `user1`'s two registrations to distinct services — otherwise `sub1` is evicted (and completed) during registration, never reaching `onModuleDestroy`'s sweep, again risking a coincidental pass.

### A4. Mechanical only — insert a service arg, no behavior change
All remaining cases register at most **one** subscriber per userId (or use genuinely different userIds), so a uniform `StreamService.STATE` insertion is safe: `:20-30` (initial state, first register), `:40-50` (separate Sets per user — `closeAll('user1')` stays unaffected, single arg), `:64-107` (all of `deregister()` — each registers one subscriber per user before deregistering; `deregister` calls gain the `service` arg, mechanical), `:140-171` (the remaining `closeAll()` cases — single register per user), `:198-204` (`size` → `'0 after closeAll'`), `:231-252` (`onModuleDestroy()`'s remaining single-register cases).

### A5. New target — reference-equality guard against WeakSet leakage (optional but recommended)
"should not mark a subscriber as evicted when it is registered, deregistered, then a fresh subscriber registers for the same slot" — a defensive regression guard: ensures `deregister`'s `evictedSubscribers.delete(subscriber)` correctly returns `false` (not evicted) for an ordinary deregister-then-fresh-register sequence, not just for the eviction path. Optional — only add if the implementer wants extra confidence in the `WeakSet` bookkeeping; not required to prove the feature.

### A6. New targets — the supersede signal is ONLY reachable via eviction, never via closeAll/onModuleDestroy, and never without an `onEvict` argument
Three cases proving `CONNECTION_SUPERSEDED`/`wasEvicted:true` cannot leak into the two other completion paths (`closeAll`, `onModuleDestroy`) or into the three non-STATE services (which never pass `onEvict`):
- **"should NOT mark a subscriber as evicted when it is completed via closeAll"** — `registry.register('user1', StreamService.STATE, sub); registry.closeAll('user1'); expect(registry.deregister('user1', StreamService.STATE, sub)).toBe(false);` (the `deregister` call is a stand-in for the real controller's teardown, which would run after `closeAll`'s `.complete()` synchronously cascades into it — see [[47-per-service-stream-eviction]] §Safety). RED until the feature: `deregister` has no return value today; once it does, `closeAll` must never have touched `evictedSubscribers`, so this reports `false` (genuine, not eviction) — which is what makes the state controller take the `handleTransportDisconnect` path, never `supersedeChildren`, on a revoke.
- **"should NOT mark a subscriber as evicted when it is completed via onModuleDestroy"** — same shape, `registry.onModuleDestroy()` in place of `closeAll`, same `wasEvicted === false` assertion. Guards server-shutdown from ever looking like a takeover.
- **"should evict via a bare complete() with no session_error when no onEvict argument is supplied"** — the shape instruction/bio/sync controllers use (§4 of [[47-per-service-stream-eviction]] — they pass no 4th argument): `const nextSpy = jest.spyOn(sub1, 'next'); registry.register('user1', StreamService.BIO, sub1); registry.register('user1', StreamService.BIO, sub2);` (no `onEvict`) → assert `sub1.complete` called once, `nextSpy` **never** called. Proves the three non-STATE services can never emit any pre-complete frame — there is no code path for it once `onEvict` is omitted.

## Part B — `module-state.grpc.controller.spec.ts`

### B1. Mechanical — insert the `service` arg into existing assertions
The shared `makeActiveStreamRegistry()` factory (`:59-65`) gains an explicit default: `deregister: jest.fn().mockReturnValue(false)` (self-documenting; functionally identical to today's implicit `undefined`, since `!undefined` is already truthy-falsy-equivalent to `!false` for the new `if (!wasEvicted)` branch — see [[47-per-service-stream-eviction]]). Update the two-arg assertions that will break once the controller calls `deregister(userId, StreamService.STATE, subscriber)` (3 args):
- **`:669-679`** — `'should call activeStreamRegistry.deregister(userId, subscriber) when the consumer unsubscribes'` → `toHaveBeenCalledWith(user.sub, StreamService.STATE, expect.any(Subscriber))`.
- **`:762-772`** — `'should run teardown when the request observable completes'` → same 3-arg update.
- **`:774-785`** — `'should run teardown when the request observable errors'` → same 3-arg update.

### B2. Characterization — already stays GREEN, no change needed (confirms the "genuine drop" requirement)
**`:681-690`** — `'should call activityEngine.handleTransportDisconnect(userId) on teardown'` — with the factory default `deregister.mockReturnValue(false)` (not evicted), the controller's new `if (wasEvicted) { supersedeChildren } else { handleTransportDisconnect }` branch takes the `else` arm → `handleTransportDisconnect` still fires exactly as today. **No modification needed** — this existing case already proves "a genuine transport drop still disconnects + arms grace for the root and every child," unmodified by this feature. **Add one assertion** to the same case (or a sibling case) confirming the negative: `expect(activityEngine.supersedeChildren).not.toHaveBeenCalled()` — requires adding `supersedeChildren: jest.fn()` to the shared `makeActivityEngine()` factory (mechanical, alongside the other engine mocks).
**`:692-761`** (`evict` on teardown, teardown call-order, error-swallowing cases) — none assert on `deregister`'s call args and none are affected by the `wasEvicted` branch (their mocked `handleTransportDisconnect` still fires under the default non-evicted mock) — unaffected, no change.

### B3. New target — eviction calls `supersedeChildren`, never `handleTransportDisconnect` (RED until the feature)
"should call activityEngine.supersedeChildren (not handleTransportDisconnect) when the teardown was caused by eviction (registry.deregister returns true)":
```ts
activeStreamRegistry.deregister.mockReturnValue(true); // simulates: this subscriber was evicted by a newer connect
const user = makeUser();
const { sub } = await setupConnectedStream(user);
sub.unsubscribe();
expect(activityEngine.supersedeChildren).toHaveBeenCalledWith(user.sub);
expect(activityEngine.handleTransportDisconnect).not.toHaveBeenCalled();
```
RED today: the teardown block (`:226-244`) calls `handleTransportDisconnect` unconditionally — there is no branch, no `supersedeChildren` call exists, and `deregister` has no return value to branch on (the mock override does nothing today).

### B4. New target — `CONNECTION_SUPERSEDED` is passed as the `onEvict` callback on register
The registry call itself is mocked in this spec (`activeStreamRegistry.register = jest.fn()`), so the eviction mechanics (§A) aren't exercised here — instead, prove the controller wires the **correct callback shape**: "should register the STATE stream with an onEvict callback that pushes a CONNECTION_SUPERSEDED session_error on the evicted subscriber" —
```ts
const user = makeUser();
const request$ = new Subject<StateRequest>();
controller.trackActivity(request$, user).subscribe({ error: () => {} });

expect(activeStreamRegistry.register).toHaveBeenCalledWith(
  user.sub,
  StreamService.STATE,
  expect.any(Subscriber),
  expect.any(Function),
);

// Simulate what the real registry does on eviction: invoke the captured callback
// against a fake "evicted" subscriber and assert the frame it pushes.
const onEvict = activeStreamRegistry.register.mock.calls[0][3];
const evictedNext = jest.fn();
onEvict({ next: evictedNext } as any);
expect(evictedNext).toHaveBeenCalledWith({
  sessionError: expect.objectContaining({ code: 'CONNECTION_SUPERSEDED' }),
});
```
RED today: `register` is called with 2 args (`userId, subscriber`), no 4th callback argument exists — `mock.calls[0][3]` is `undefined`, calling it throws.

## Part C — `activity-engine.service.spec.ts` (new `supersedeChildren` coverage)
`activity-engine.service.spec.ts` seeds sessions almost exclusively via the legacy single-slot `activitySessionStore.set(userId, state)` helper (a sole-child convenience — confirmed by grep: 15 occurrences, only one `setRoot` call in the whole file, no `addChild` calls anywhere yet). `supersedeChildren` needs a **root + multiple children**, so these new cases seed via the multi-session API directly: `activitySessionStore.setRoot(userId, rootId, state)` + `activitySessionStore.addChild(userId, childId, state)` (both public on `ActivitySessionStore`, confirmed at `activity-session-store.service.ts:65,92`).

Add `describe('supersedeChildren', ...)`:
- **PRIMARY TARGET — race-safety (RED until [[47-per-service-stream-eviction]]):** "should clear the store synchronously, before the first DB await resolves" — this is the direct proof of note 47's §Safety-2 argument (the two-loop design, not a single `for...await` loop):
  ```ts
  activitySessionStore.setRoot('user-1', 'root-1', { sessionId: 'root-1', activityType: ActivityType.ROOT, startedAt: new Date(), lastActivityAt: new Date(), isPaused: false });
  activitySessionStore.addChild('user-1', 'child-1', { sessionId: 'child-1', activityType: ActivityType.BREATH, startedAt: new Date(), lastActivityAt: new Date(), isPaused: false });
  let resolveFindOne!: (v: any) => void;
  repo.findOne.mockReturnValue(new Promise((resolve) => { resolveFindOne = resolve; }));

  const pending = engine.supersedeChildren('user-1');
  // The DB round-trip hasn't resolved yet — but the store must already be clear.
  expect(activitySessionStore.listChildren('user-1')).toHaveLength(0);

  resolveFindOne(makeSession({ id: 'child-1' }));
  await pending;
  ```
  RED today: `supersedeChildren` doesn't exist. This is the single most important case in this note — a naive `for (const child of children) { await this.stopActivity(...) }` implementation would fail it (the store wouldn't clear until each child's DB round-trip completes), silently reintroducing the takeover race even though the "children end up terminated" outcome looks identical in a non-concurrent test.
- **TARGET — ends children (terminal status), leaves the root ACTIVE:**
  ```ts
  const rootState = { sessionId: 'root-1', activityType: ActivityType.ROOT, startedAt: new Date(), lastActivityAt: new Date(), isPaused: false };
  activitySessionStore.setRoot('user-1', 'root-1', rootState);
  activitySessionStore.addChild('user-1', 'child-1', { sessionId: 'child-1', activityType: ActivityType.BREATH, startedAt: new Date(), lastActivityAt: new Date(), isPaused: false });
  activitySessionStore.addChild('user-1', 'child-2', { sessionId: 'child-2', activityType: ActivityType.MEDITATION, startedAt: new Date(), lastActivityAt: new Date(), isPaused: false });
  repo.findOne
    .mockResolvedValueOnce(makeSession({ id: 'child-1' }))
    .mockResolvedValueOnce(makeSession({ id: 'child-2' }));
  repo.save.mockImplementation((s) => Promise.resolve(s));

  await engine.supersedeChildren('user-1');

  // Children: terminal status, ended now.
  expect(repo.save).toHaveBeenCalledTimes(2); // never a 3rd call for the root
  expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'child-1', status: SessionStatus.INTERRUPTED, endedAt: expect.any(Date) }));
  expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'child-2', status: SessionStatus.INTERRUPTED, endedAt: expect.any(Date) }));
  expect(activitySessionStore.listChildren('user-1')).toHaveLength(0);

  // Root: untouched — same in-memory state object, still resolvable, never persisted.
  expect(activitySessionStore.getRootId('user-1')).toBe('root-1');
  expect(activitySessionStore.getRoot('user-1')).toBe(rootState); // same reference — never mutated or replaced
  expect(repo.findOne).not.toHaveBeenCalledWith({ where: { id: 'root-1' } });
  expect(repo.save).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'root-1' }));
  ```
  Also assert `streamEngine.push` (the mocked `pushSessionEventMarker` sink) was called with `StreamSessionEvent.INTERRUPTED` for each child id, and `eventEmitter.emit` with `SessionEvents.INTERRUPTED` — mirroring the existing assertions `stopActivity`'s own tests already make for the same status (grep `SessionEvents.INTERRUPTED` in this file for the exact `toHaveBeenCalledWith` shape to mirror).

  **Field choice — `endedAt`, not `disconnectedAt` (reaffirmed against the literal ask):** the request phrasing said "terminal status + `disconnectedAt`," but [[47-per-service-stream-eviction]] §6 deliberately sets `endedAt = now` (mirroring `stopActivity`'s own field, not `abandonActivity`'s). `disconnectedAt` belongs to the `DISCONNECTED`→grace→`ABANDONED` path (`abandonActivity` reads `session.disconnectedAt ?? now` as `endedAt`); a superseded child is never `DISCONNECTED` — it is cut short directly from `ACTIVE`, immediately, by a system decision, not a timeout. Setting `disconnectedAt` on it would be a semantically wrong signal (it would look like a grace-timeout candidate to any code reading that field). This test asserts `endedAt`, matching the pinned design — do not add a `disconnectedAt` assertion.
- **CHARACTERIZATION — no-op when there are no children:** root-only or nothing at all seeded → `repo.save` never called, resolves without throwing.

## Two-state observability
**Part A vantage:** the registry's own `size` getter, `jest.spyOn(subscriber, 'next'|'complete')` (including call-order via `mock.invocationCallOrder`), the `onEvict` mock's captured call args, and `deregister`'s boolean return value — directly observable, no mocking layer between the test and the code under test. RED today because `register` has no `service`/`onEvict` parameters (loud, won't compile against the new call sites), performs no eviction (size/spy/callback assertions fail), and `deregister` has no return value (A6's `wasEvicted` assertions fail); GREEN once [[47-per-service-stream-eviction]] lands.
**Part B vantage:** `activityEngine.supersedeChildren`/`handleTransportDisconnect` mock call counts (captured via the existing `setupConnectedStream` + `sub.unsubscribe()` harness) and the captured `onEvict` callback's observable side effect (`evictedNext` calls). RED today (mocks have no effect on real control flow, and the 4th `register` arg doesn't exist); GREEN once the controller branches on `wasEvicted` and wires the callback.
**Part C vantage:** the real `ActivitySessionStore`'s `listChildren`/`getRootId` (no mocking layer — a genuine store instance) plus the mocked `repo.save`/`streamEngine.push`/`eventEmitter.emit`. RED today because `supersedeChildren` doesn't exist on `ActivityEngine`; GREEN once it lands with the two-loop (sync-clear-then-persist) shape.

## Findings — cross-interaction to record (not this task's concern, informational)
After a takeover, the **new** device's own `handleReconnect` (unaffected by this task) finds zero live children — they were superseded by the evicted stream's teardown before the new stream's `setup()` runs (§Safety-2 in [[47-per-service-stream-eviction]]) — and resumes only the root, composing with [[45-per-child-resumed-frames-on-reconnect]]'s existing zero-children fallback. No additional test needed here for that composition — it falls out of each feature's own already-covered behavior.
