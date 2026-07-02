# Per-service last-connect-wins stream eviction + takeover (not abandon)

**Date:** 2026-07-02
**Source:** conversation context (product decision — single-session engine)

Feature task. Tested by [[46-test-per-service-stream-eviction]] (lands first, TDD). No proto change, no migration. Touches `active-stream-registry.service.ts` + a new `constants/stream-service.ts` + all 4 `*.grpc.controller.ts` register/deregister sites + `module-state.grpc.controller.ts`'s teardown branch + a new `ActivityEngine.supersedeChildren` method — kept as **one** atomic task (not split further) because the state controller's takeover logic must land in the **same** deploy as the eviction mechanism: shipping eviction alone would leave an evicted STATE stream's existing unconditional `handleTransportDisconnect` call in place, **abandoning** the very sessions the product decision says must be taken over, not dropped — a real intermediate regression, not merely an incomplete feature. The atomicity gate does not permit that split.

## Product decision (settled — do not re-litigate)
The realtime engine is **single-session per user**. The most-recently-connecting stream **wins**; the previously-connected one is **evicted** (closed gracefully, with an explicit warning frame first — see §7). A new device taking over does **not** abandon the sessions wholesale: it inherits the shared **root** (the continuous bio axis stays live, uninterrupted), but the evicted connection's **children** (the practices it had running) are terminated — the new device starts with a clean slate and never inherits a practice it didn't itself start. This is a refinement of "takeover" settled after the original brief: **root persists, children end.**

## Problem — two gaps, verified at HEAD

**Gap 1 — no eviction at all.** `ActiveStreamRegistry.register(userId, subscriber)` (`src/realtime/services/active-stream-registry.service.ts:16-23`) only **adds** to a `Set<Subscriber<any>>` keyed by `userId`:
```ts
register(userId: string, subscriber: Subscriber<any>): void {
  let set = this.streams.get(userId);
  if (!set) { set = new Set(); this.streams.set(userId, set); }
  set.add(subscriber);
}
```
The registry is a shared singleton (`realtime.module.ts:48`, plain provider) used by **all four** streams — state (`module-state.grpc.controller.ts:145`), instruction (`module-instruction-stream.grpc.controller.ts:55`), bio (`module-biometric-stream.grpc.controller.ts:57`), sync (`sync-stream.grpc.controller.ts:49`) — so today's `Set<userId>` mixes all four services under one key with no per-service distinction. `docs/realtime/overview.md:36` documents "one connection per service" as if implemented — it is **not**.

**Gap 2 — reconnect doesn't distinguish a takeover from a plain reconnect.** `ActivityEngine.handleReconnect` (`activity-engine.service.ts:604-654`) resumes **every** live session unconditionally (loop at `:621-629`, no status filter) whenever it's invoked. Per the settled refinement, on a takeover the new device should inherit the root but **not** any pre-existing children — this task achieves that **without touching `handleReconnect` at all**: by the time the new device's `setup()` calls `handleReconnect`, the evicted connection's children have already been synchronously removed from the store (see §6 `supersedeChildren`), so `handleReconnect`'s existing unconditional loop naturally has **zero** children to resume — it resumes only the root. This is the same "empty-children fallback" code path `handleReconnect`/the controller's reconnect emission already exercise today when a user reconnects with no live children (root-only case) — no new branch needed there, and it composes directly with [[45-per-child-resumed-frames-on-reconnect]]'s per-child emission (zero children → one RESUMED frame for the root, exactly as note 45 already specifies for that case).

## Design — pinned

### 1. New discriminator: `StreamService`
New file `src/realtime/constants/stream-service.ts`, matching the existing `as const` convention (`constants/stream-data-types.ts`):
```ts
export const StreamService = {
  STATE: 'state',
  INSTRUCTION: 'instruction',
  BIO: 'bio',
  SYNC: 'sync',
} as const;

export type StreamService = (typeof StreamService)[keyof typeof StreamService];
```

### 2. Registry redesign — eviction key is `(userId, service)`, single slot per key
Restructure `active-stream-registry.service.ts` from `Map<string, Set<Subscriber<any>>>` to a **nested single-slot** map: `Map<userId, Map<StreamService, Subscriber<any>>>`. A single slot (not a `Set`) is correct **because** eviction guarantees at most one live subscriber per `(userId, service)` at any time — see §Safety below for why the eviction-then-overwrite sequence is race-free.

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subscriber } from 'rxjs';
import { StreamService } from '../constants/stream-service';

@Injectable()
export class ActiveStreamRegistry implements OnModuleDestroy {
  private readonly streams = new Map<string, Map<StreamService, Subscriber<any>>>();
  private readonly evictedSubscribers = new WeakSet<Subscriber<any>>();

  get size(): number {
    let count = 0;
    for (const serviceMap of this.streams.values()) count += serviceMap.size;
    return count;
  }

  register(
    userId: string,
    service: StreamService,
    subscriber: Subscriber<any>,
    onEvict?: (evicted: Subscriber<any>) => void,
  ): void {
    const existing = this.streams.get(userId)?.get(service);
    if (existing && existing !== subscriber) {
      this.evictedSubscribers.add(existing);
      onEvict?.(existing); // service-specific pre-complete frame — see §7
      existing.complete(); // synchronous — see §Safety; may prune streams[userId]
    }
    // Re-fetch after eviction — the prior map may have been pruned by the
    // evicted subscriber's synchronous deregister teardown (see §Safety).
    let serviceMap = this.streams.get(userId);
    if (!serviceMap) {
      serviceMap = new Map();
      this.streams.set(userId, serviceMap);
    }
    serviceMap.set(service, subscriber);
  }

  deregister(userId: string, service: StreamService, subscriber: Subscriber<any>): boolean {
    const wasEvicted = this.evictedSubscribers.delete(subscriber);
    const serviceMap = this.streams.get(userId);
    if (serviceMap?.get(service) === subscriber) {
      serviceMap.delete(service);
      if (serviceMap.size === 0) this.streams.delete(userId);
    }
    return wasEvicted;
  }

  hasLiveSubscriber(userId: string): boolean {
    return (this.streams.get(userId)?.size ?? 0) > 0;
  }

  closeAll(userId: string): void {
    const serviceMap = this.streams.get(userId);
    if (!serviceMap) return;
    for (const subscriber of serviceMap.values()) subscriber.complete();
    this.streams.delete(userId);
  }

  onModuleDestroy(): void {
    for (const serviceMap of this.streams.values()) {
      for (const subscriber of serviceMap.values()) subscriber.complete();
    }
    this.streams.clear();
  }
}
```

**What changed vs. today, precisely:**
- `register`/`deregister` gain a mandatory `service: StreamService` middle parameter. `register` also gains an **optional** trailing `onEvict?: (evicted: Subscriber<any>) => void` — a service-specific hook invoked on the evicted subscriber immediately **before** `.complete()`, used by the STATE controller to push the `CONNECTION_SUPERSEDED` warning frame (§7). The registry stays generic (`Subscriber<any>`) and does not know or care about any particular service's frame shape — it only invokes the caller-supplied callback, if any, with the raw evicted subscriber reference.
- `register` now evicts: if a **different** subscriber already occupies the `(userId, service)` slot, it is marked in `evictedSubscribers` (a `WeakSet`, so no manual cleanup needed — entries are GC'd once the subscriber is unreferenced), `onEvict` (if supplied) fires, and **then** it is `.complete()`'d — before the new subscriber overwrites the slot.
- `deregister` now returns `boolean` — `wasEvicted` — via `WeakSet.prototype.delete`, which itself returns whether the value was present. The defensive `serviceMap?.get(service) === subscriber` check only clears the slot if the caller's subscriber is still the **current** occupant (guards a stale/late deregister from clobbering a newer registration — see §Safety for why this can't actually happen today, kept as a defensive invariant regardless).
- `closeAll`/`hasLiveSubscriber`/`onModuleDestroy`/`size` keep their **existing signatures** (`userId`-only or none) and sweep **all services** for that user — confirmed as the only call sites: `hasLiveSubscriber` from `session-watchdog.service.ts:80,117` (the janitor — must stay service-agnostic, "is this user connected at all"), `closeAll` from `module-state.grpc.controller.ts:263` (`handleSessionRevoked` — auth revocation must close **everything**, unchanged).
- **Idempotent re-register preserved:** the `existing !== subscriber` check means registering the **identical** subscriber object twice for the same `(userId, service)` is a no-op eviction-wise (guards a footgun: without this check, the subscriber would `.complete()` itself while still being the value re-inserted into the slot).
- **`closeAll`/`onModuleDestroy` do NOT mark subscribers as evicted** — their `.complete()` calls leave `evictedSubscribers` untouched, so a subsequent `deregister` from that teardown reports `wasEvicted: false`, and the state controller's teardown still calls `handleTransportDisconnect` exactly as it does **today** for a revoked session. This task changes **only** the eviction path's behavior — revocation semantics are untouched.

### 3. Safety — why a single slot (not a `Set`) is race-free
`Subscriber.complete()` is synchronous: it invokes the observer's `complete` handler and then synchronously runs every teardown registered via `subscriber.add(...)`. In every one of the four controllers, the teardown callback is exactly the closure that calls `activeStreamRegistry.deregister(...)`. So the sequence inside `register()`'s eviction branch is entirely synchronous and single-threaded:
1. `onEvict?.(existing)` fires (if supplied) — for the STATE controller this synchronously pushes the `CONNECTION_SUPERSEDED` frame onto the evicted subscriber via `existing.next(...)`.
2. `existing.complete()` is called.
3. This synchronously runs the OLD subscriber's `subscriber.add(() => { ... deregister(userId, service, existing) ... })` teardown — which, for the STATE controller, also **starts** the `supersedeChildren` async IIFE (fire-and-forget; see §6 for why its *first* synchronous portion still matters).
4. That `deregister` call finds `serviceMap.get(service) === existing` still true (the new subscriber hasn't been stored yet — step 5 hasn't run), so it correctly clears the slot and reports `wasEvicted: true`. **If `existing` was the only entry for `userId`, this also deletes the `userId` key from the outer map** — the inner map object is now detached/orphaned.
5. Control unwinds back to `register()`. Because step 4 may have deleted the `userId` key (detaching the map `register()` originally read at the top of the function), `register()` must **re-fetch** `this.streams.get(userId)` at this point rather than reuse its earlier reference — recreating the inner map if it was pruned — before storing the **new** subscriber. Storing into a stale, now-detached map reference would silently lose the new subscriber (`this.streams.get(userId)` would return `undefined` afterwards) even though `register()` itself completed without error.
There is no window where both old and new subscribers could be attributed to the same slot, and no window where the old subscriber's belated deregister could clobber the new one — by the time step 5 runs, the old subscriber's deregister has already completed, and the re-fetch guarantees the new subscriber lands in whichever map (existing or freshly recreated) `this.streams` actually references. **This entire sequence (steps 1–5) completes synchronously before `register()` returns**, which — since `register()` is called before `setup()`/`handleReconnect` in `trackActivity`'s source order (§6) — is the guarantee that makes the takeover race-free too.

### 4. Wire all 4 controllers to pass their `StreamService`
One line each (register) + one line each (deregister), all confirmed at HEAD:
- **State** — `module-state.grpc.controller.ts:145` `register(userId, subscriber)` → `register(userId, StreamService.STATE, subscriber, onEvict)`, where `onEvict` is the `CONNECTION_SUPERSEDED`-emitting callback (§7). Deregister site: see §5 (takeover logic replaces this line).
- **Instruction** — `module-instruction-stream.grpc.controller.ts:55` register, `:135` deregister → both gain `StreamService.INSTRUCTION`, no `onEvict` argument. No other change — this stream carries no session lifecycle, eviction just stops the old device from streaming.
- **Bio** — `module-biometric-stream.grpc.controller.ts:57` register, `:75` deregister → both gain `StreamService.BIO`, no `onEvict`. Same — no lifecycle side effect to guard.
- **Sync** — `sync-stream.grpc.controller.ts:49` register, `:152` deregister → both gain `StreamService.SYNC`, no `onEvict`. The adjacent `syncStreamService.deregister(userId, pushFn)` call (`:153`) is a **different** service (`SyncStreamService`, unrelated to `ActiveStreamRegistry`) — untouched.

### 5. Takeover — supersede children, keep the root (state controller only)
`module-state.grpc.controller.ts`'s teardown block (`:226-244`) today unconditionally calls `handleTransportDisconnect`:
```ts
// :226-244 today
subscriber.add(() => {
  this.activeStreamRegistry.deregister(userId, subscriber);
  const connectedDurationMs = connectedAt ? Date.now() - connectedAt : 0;
  this.logger.log(`Disconnected: userId=${userId} connectedDurationMs=${connectedDurationMs}`);

  (async () => {
    await this.activityEngine.handleTransportDisconnect(userId);
  })().catch((err: unknown) => {
    this.logger.error(`Failed to record disconnect: userId=${userId}`, err);
  });

  this.rateLimiterService.evict(`activity-start:${userId}`);
  this.idempotency.evictUser(userId);
});
```
Change to **branch** on the new `wasEvicted` return value — a genuine drop keeps today's `handleTransportDisconnect` path unchanged; an eviction instead calls the new `supersedeChildren` (§6), never `handleTransportDisconnect`:
```ts
subscriber.add(() => {
  const wasEvicted = this.activeStreamRegistry.deregister(userId, StreamService.STATE, subscriber);
  const connectedDurationMs = connectedAt ? Date.now() - connectedAt : 0;
  this.logger.log(
    `Disconnected: userId=${userId} connectedDurationMs=${connectedDurationMs} evicted=${wasEvicted}`,
  );

  if (wasEvicted) {
    (async () => {
      await this.activityEngine.supersedeChildren(userId);
    })().catch((err: unknown) => {
      this.logger.error(`Failed to supersede children: userId=${userId}`, err);
    });
  } else {
    (async () => {
      await this.activityEngine.handleTransportDisconnect(userId);
    })().catch((err: unknown) => {
      this.logger.error(`Failed to record disconnect: userId=${userId}`, err);
    });
  }

  this.rateLimiterService.evict(`activity-start:${userId}`);
  this.idempotency.evictUser(userId);
});
```
- **Genuine drop (`!wasEvicted`) is byte-for-byte identical to today** — `handleTransportDisconnect` fires, arming grace + `DISCONNECTED` status for the root **and every child**, exactly as before this task. This task changes **only** the eviction branch.
- `rateLimiterService.evict`/`idempotency.evictUser` stay **unconditional** — out of scope for this task (pre-existing behavior: any teardown, evicted or not, already clears the userId-keyed rate-limit/idempotency buckets today; a takeover resetting them for the user is an acceptable, unchanged side effect).
- No ordering change otherwise — `deregister` still runs first, `evict`/`evictUser` still run last.
- The **new** device's own `handleReconnect` (called from its own `setup()`, unaffected) then resumes only the root — see §Problem Gap 2 and §6's synchronous-store-clear guarantee.

### 6. `ActivityEngine.supersedeChildren` — end the children, leave the root untouched
New method on `ActivityEngine`. Ends **every** live child of the evicted user (status `INTERRUPTED`, `endedAt = now`), removing each from the in-memory store; the **root** is never enumerated, never touched — it stays exactly as it was (still `ACTIVE`, no `disconnectedAt`), ready for the new stream's `handleReconnect` to resume it.

**Status choice — `INTERRUPTED`, justified against existing terminal-status handling.** `SessionStatus` (`enums/session-status.enum.ts`) has `ACTIVE | DISCONNECTED | COMPLETED | ABANDONED | INTERRUPTED | RESUMED` — no status is added, and none should be (a new value would need a Postgres enum migration and, since `ActivityStatus` in `proto/module_state.proto` mirrors the same value set, a proto change — both explicitly out of scope). Of the existing values:
- `ABANDONED` is wrong — that status specifically means "the grace period elapsed with no reconnect" (`abandonActivity`, `activity-engine.service.ts:322-360`, guarded by `session.status !== DISCONNECTED` and set `endedAt = session.disconnectedAt ?? now`). A superseded child was never disconnected — it is cut short while still `ACTIVE`, by a decision the *system* made (a new connection arrived), not by a timeout.
- `INTERRUPTED` is correct — it is **already** the status `stopActivity` (`activity-engine.service.ts:410-477`) uses for "ended abnormally, not via its own natural conclusion or a grace timeout" (today: an explicit client `activity:stop`). "Superseded by a new connection" is a system-initiated equivalent of the same category — the practice was cut short, not completed, not abandoned-via-timeout. Reusing `INTERRUPTED` means the existing `StreamSessionEvent.INTERRUPTED` marker and `SessionEvents.INTERRUPTED` domain event fire unchanged — no new marker/event value needed.

**Implementation — the store must be cleared synchronously, before any DB write (see §Safety-2 for why):**
```ts
async supersedeChildren(userId: string): Promise<void> {
  const children = this.activitySessionStore.listChildren(userId);
  // Clear the store SYNCHRONOUSLY, before any DB await — see §Safety-2.
  for (const child of children) {
    this.activitySessionStore.removeChild(userId, child.sessionId);
  }
  const now = new Date();
  for (const child of children) {
    const session = await this.repo.findOne({ where: { id: child.sessionId } });
    if (!session) continue; // already gone from DB — nothing to persist
    session.status = SessionStatus.INTERRUPTED;
    session.endedAt = now;
    const saved = await this.repo.save(session);
    this.pushSessionEventMarker(saved.id, StreamSessionEvent.INTERRUPTED);
    this.eventEmitter.emit(SessionEvents.INTERRUPTED, {
      sessionId: saved.id,
      userId,
      startedAt: saved.startedAt,
      endedAt: saved.endedAt,
      activityType: saved.activityType,
      activityRefId: saved.activityRefId,
    });
  }
  this.logger.log(
    `Sessions superseded (eviction takeover): userId=${userId} count=${children.length}`,
  );
}
```
Deliberately **not** a loop calling the existing `stopActivity(userId, childId)` per child — `stopActivity` re-reads `activitySessionStore.getSession(userId, sid)` as its own guard (`:423-429`) and returns early if the state is missing; if the store were cleared first (required by §Safety-2) `stopActivity` would immediately no-op and never persist the `INTERRUPTED` status to the DB. `supersedeChildren` instead captures the children's ids **before** clearing the store, then persists each independently.

**`activitySessionStore.removeChild(userId, sessionId): boolean`** (`activity-session-store.service.ts`) is the store's own public removal method — already used internally by `ActivityEngine.removeSessionFromStore` (a private helper, `:79-85`) for the non-root branch; `supersedeChildren` calls it directly since it only ever touches children, never root.

### Safety-2 — why the store must clear before any DB `await`, and why this closes the takeover race
`handleReconnect` (§Problem Gap 2) reads `activitySessionStore.listChildren(userId)` **synchronously**, as the very first thing it does (`activity-engine.service.ts:609-611`). Tracing the full call sequence for a takeover:
1. Device B's `trackActivity` calls `register(userId, StreamService.STATE, newSub, onEvict)` — **synchronous**.
2. Eviction fires: `onEvict` runs, `existing.complete()` runs, which **synchronously** cascades into device A's teardown (§Safety steps 1–5) — which **starts** (but does not await) the `supersedeChildren` IIFE.
3. `supersedeChildren`'s body begins executing **synchronously**: `listChildren(userId)` (sync) then the **first** `for` loop — `removeChild(userId, ...)` for every child (sync, in-memory `Map` deletes, no `await`). This loop runs to completion before the function's **first** `await` (which is inside the *second* loop, `await this.repo.findOne(...)`).
4. Only **then** does `supersedeChildren` hit its first `await` and yield control. By this point the store is already fully cleared of device A's children.
5. Control unwinds synchronously back through steps 2→1 — `register()` returns.
6. **Only now**, in `trackActivity`'s source order, is `setup()` defined and invoked, calling `handleReconnect`, whose synchronous `listChildren(userId)` read (step 1 of Gap 2) is guaranteed to observe the **already-cleared** store.
Because steps 1–5 are entirely synchronous and JS is single-threaded, there is no way for `handleReconnect`'s read to interleave with `supersedeChildren`'s store mutation — the store-clearing **must** happen before any `await`, or this ordering guarantee breaks and `handleReconnect` could race `resumeActivity` against `supersedeChildren`'s DB write for the same row (two concurrent, conflicting `repo.save` calls on one session). This is the reason the implementation is split into two loops instead of one `for (const child) { await ... }` loop that would interleave store-clearing with DB writes.

### 7. `CONNECTION_SUPERSEDED` — the anti-ping-pong signal (state stream only)
**Problem this solves:** two clients simultaneously online (e.g. app foregrounded on two devices) would otherwise both see their stream close via a bare `complete()` and — unable to distinguish "I was taken over" from "the network dropped" — both attempt to reconnect, each evicting the other, forever (reconnect ping-pong).

**Mechanism — pinned:** the STATE controller passes an `onEvict` callback to `register` (§2, §4) that runs synchronously on the evicted subscriber, **before** `.complete()`:
```ts
// module-state.grpc.controller.ts — register call, replacing :145
this.activeStreamRegistry.register(userId, StreamService.STATE, subscriber, (evicted) => {
  evicted.next({
    sessionError: {
      code: 'CONNECTION_SUPERSEDED',
      message: 'Superseded by a new connection',
      timestamp: Date.now(),
    },
  });
});
```
`'CONNECTION_SUPERSEDED'` is a plain literal string, matching the controller's existing precedent for a new client-facing code that isn't registered in `WsErrorCode` (`'CANNOT_END_ROOT'`, `module-state.grpc.controller.ts:454,495` — added by [[34-deliver-root-id-on-connect]]). `StateErrorEvent` is the existing proto shape (`{ code, message, timestamp }`, `proto/module_state.proto:97`) — **no proto change**. The client receives, in order: `session_error { code: CONNECTION_SUPERSEDED }`, then a graceful `onCompleted` — letting it distinguish "another connection took over, go passive, do not auto-reconnect" from a network drop (`onError`, no prior `CONNECTION_SUPERSEDED` frame).

**Only the STATE stream gets this.** Instruction/bio/sync pass no `onEvict` argument — their eviction stays a bare `.complete()` (§8): they carry no session lifecycle and the client only needs to stop streaming, not distinguish takeover from drop (there's nothing for it to reconcile on those streams).

### 8. Data/sync streams — no special handling beyond the per-service key
Instruction/bio/sync teardown blocks (`module-instruction-stream.grpc.controller.ts` teardown, `module-biometric-stream.grpc.controller.ts:74-78`, `sync-stream.grpc.controller.ts` teardown) carry **no** session-lifecycle side effect today (confirmed by reading each — they only `deregister` + `unsubscribe` + log). Evicting them via `.complete()` (no `onEvict`) simply stops the old device's stream; nothing else to guard.

## Client-visible signal (mobile-facing — note only, do not edit mind_mobile)
**STATE stream:** an evicted subscriber receives, in order, `session_error { code: 'CONNECTION_SUPERSEDED' }` (§7) then a graceful `.complete()` (`onCompleted`) — **not** an `onError`, **not** an `{abandoned}` state-frame. This is the anti-ping-pong signal: the client that sees `CONNECTION_SUPERSEDED` must go passive (do not auto-reconnect) — a plain network drop instead surfaces as `onError` with no prior `CONNECTION_SUPERSEDED` frame, and *that* case should reconnect as today. No proto change (`StateErrorEvent` is the existing shape). **Instruction/bio/sync streams:** eviction stays a bare `.complete()`, no error frame — the client just stops streaming; these carry no session lifecycle to reconcile. Flag to the mobile side (their own handoff/plan): the STATE stream's `.complete()` still also occurs for "server shutting down" (`onModuleDestroy`) and "auth revoked" (`closeAll`) — those remain **not** preceded by `CONNECTION_SUPERSEDED`, so the discriminator is specifically "did I see `CONNECTION_SUPERSEDED` before the completion," not "did the stream complete gracefully at all."

## Cross-interactions
- **Composes with [[45-per-child-resumed-frames-on-reconnect]] (already shipped):** after a takeover, the new device's `handleReconnect` finds zero live children (they were superseded, §6) and resumes only the root — note 45's per-child loop naturally emits nothing for children and the existing root-only fallback frame fires, exactly as note 45 already specifies for the zero-children case. No new wiring needed between the two features.
- **`docs/realtime/overview.md:36`** currently *describes* per-service eviction as already implemented (it wasn't) and says nothing about takeover/supersession or `CONNECTION_SUPERSEDED`. Corrected by the separate docs task [[48-docs-correct-eviction-policy]] (Russian, correction not rewrite), which must fold in both this task's mechanism and the amendments.

## Guards / gotchas
- Do not add a status filter to `handleReconnect`'s resume loop (`:621-629`) — it is already correct **unmodified**: once children are superseded (§6) before `handleReconnect` ever runs, the loop naturally has nothing but the root to resume.
- Do not mark `closeAll`/`onModuleDestroy` completions as evicted — they must continue to trigger `handleTransportDisconnect` in the state controller exactly as today (revocation/shutdown are not takeovers, and must **not** emit `CONNECTION_SUPERSEDED` — only `register`'s eviction path does).
- The `existing !== subscriber` reference check in `register` is mandatory — omitting it makes a same-reference re-register self-evict (a footgun with no production trigger today, but guarded regardless per [[46-test-per-service-stream-eviction]]'s A2 case). It also means a same-reference re-register never fires `onEvict` — correct, since nothing was actually evicted.
- Do not use `ABANDONED` for superseded children (§6 justifies `INTERRUPTED`) and do not add a new `SessionStatus`/`ActivityStatus` value — both would require a migration and/or proto change, out of scope.
- `supersedeChildren` must clear the store **before** any DB `await` (§Safety-2) — this is not a style preference, it is what prevents `handleReconnect`'s synchronous `listChildren` read from racing a still-in-flight `stopActivity`-style DB write for the same child row.

## Verify
- Two connects to the STATE stream for one user (different devices) → the first stream's subscriber receives `session_error { code: CONNECTION_SUPERSEDED }` **then** `onCompleted` (not `onError`); `handleTransportDisconnect` is **not** called for it; its children are `INTERRUPTED` with `endedAt` set, removed from the store; the root is untouched (still `ACTIVE`); the second stream's `handleReconnect` resumes and reports only the root.
- A genuine transport drop (real network failure, only one connect) → no `CONNECTION_SUPERSEDED` frame, `handleTransportDisconnect` fires and grace arms for the root **and** every child, exactly as today.
- A device's own 4 streams (state/instruction/bio/sync) connecting together do not evict each other (different `service` keys under the same `userId`) and never trigger `onEvict`.
- `closeAll`/`onModuleDestroy`/auth revocation continue to close everything, never emit `CONNECTION_SUPERSEDED`, and still trigger disconnect handling (not supersession) for the state stream, unchanged.
