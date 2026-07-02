# Code Review (Pass 2) — Per-service last-connect-wins stream eviction + CONNECTION_SUPERSEDED + supersede-children takeover

**Branch:** `feature/root-session`
**Scope:** full `git diff HEAD` + full read of every changed file. Verified what changed since review 1, re-verified the fix empirically, and re-confirmed the previously-cleared correctness properties still hold.

## What changed since review 1
The only production-code delta is the `ActiveStreamRegistry.register` fix; the spec note (`47-…§2/§Safety`) and the registry spec were updated to match. All other changed files (`activity-engine.service.ts`, the four controllers, their specs) are byte-identical to review 1.

## Finding 1 (review 1) — RESOLVED — `register()` no longer detaches the new subscriber

`register` now reads `existing` fresh (`this.streams.get(userId)?.get(service)`), performs the eviction, then **re-fetches** the inner map *after* `existing.complete()` — recreating it if the evicted subscriber's synchronous `deregister` teardown pruned the `userId` key — before storing the new subscriber (`active-stream-registry.service.ts:25-38`):

```ts
const existing = this.streams.get(userId)?.get(service);
if (existing && existing !== subscriber) {
  this.evictedSubscribers.add(existing);
  onEvict?.(existing);
  existing.complete();          // may prune streams[userId]
}
let serviceMap = this.streams.get(userId);   // re-fetch — prior ref may be detached
if (!serviceMap) { serviceMap = new Map(); this.streams.set(userId, serviceMap); }
serviceMap.set(service, subscriber);
```

Verified:
- Independent reproduction (evict when STATE is the only service, using controller-style `subscriber.add(deregister)` teardowns): `size === 1`, `hasLiveSubscriber === true`, and a third `register` still evicts the second — i.e. the new subscriber is genuinely tracked. The review-1 repro that failed now passes.
- A regression test covering exactly this (`active-stream-registry.service.spec.ts:128-150`) is present and green.
- Idempotent same-reference re-register still short-circuits before eviction (`existing === subscriber`) and the re-fetch is a harmless no-op; the idempotency test passes.
- Full realtime suite: 15 suites / 403 tests pass. Changed-file typecheck clean (the pre-existing `biometric-stream-engine.service.spec.ts` `TS2352` errors are unrelated — that file is not in this diff).

## Re-confirmed clearances (unchanged code)
- **`supersedeChildren` race-safety** — store cleared in a synchronous first loop before any `await`; `handleReconnect` reads `listChildren` synchronously before its first `await`; child rows (superseded) and the root row (resumed) never overlap.
- **`INTERRUPTED` marker/event payload** matches `stopActivity`; `@OnEvent(SessionEvents.INTERRUPTED)` consumer unaffected. Root never enumerated or persisted.
- **`wasEvicted` teardown branch** — genuine-drop path is byte-for-byte the prior `handleTransportDisconnect`; `rateLimiterService.evict`/`idempotency.evictUser` remain unconditional and last.
- **`closeAll`/`onModuleDestroy`** never touch `evictedSubscribers` → revocation/shutdown teardown reports `wasEvicted = false`; `handleSessionRevoked` and the watchdog reap path are unchanged. Deleting the current key during `Map.values()` iteration is well-defined and is the pre-existing pattern.
- **Controller wiring** — all four pass the correct `StreamService` on register+deregister; only STATE passes `onEvict`; `syncStreamService.deregister(userId, pushFn)` untouched; `closeAll`/`hasLiveSubscriber` keep `userId`-only signatures.
- **`CONNECTION_SUPERSEDED`** uses the existing `StateErrorEvent` shape with a literal code; `next`-before-`complete` ordering enforced and tested. No proto change, no migration.

No outstanding findings.

REVIEW_PASS
