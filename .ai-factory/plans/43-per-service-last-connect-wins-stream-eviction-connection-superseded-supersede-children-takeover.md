# Plan: Per-service last-connect-wins stream eviction + CONNECTION_SUPERSEDED + supersede-children takeover

## Context
Make the realtime engine single-session per user: the most-recently-connecting stream wins and evicts the previously-connected one per `(userId, service)`, the evicted STATE stream receives a `CONNECTION_SUPERSEDED` warning frame before closing (anti-ping-pong), and a takeover ends the evicted connection's children (`INTERRUPTED`) while the shared root persists — a genuine transport drop is unchanged.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Notes for the implementer
- This milestone is **one atomic deploy** — all tasks below ship in a **single commit** (see Commit Plan). Shipping the eviction mechanism without the STATE takeover branch would abandon sessions the product decision says must be taken over — a real intermediate regression. Do not split into multiple commits.
- The full spec is `.ai-factory/notes/47-per-service-stream-eviction.md` — it pins every signature, code block, and ordering guarantee. Follow it verbatim; the code snippets there are the intended implementation, not illustrations.
- Companion tests already landed (frozen task, roadmap line 156). No proto change, no migration.
- Hard rules (`.ai-factory/RULES.md`): no non-null assertion `!`; logs lean (outcomes/IDs only, no PII). Logging via `new Logger(ClassName.name)` per `@nestjs/common`.

## Tasks

### Phase 1: Discriminator + registry redesign

- [x] **Task 1: Add the `StreamService` discriminator constant**
  Files: `src/realtime/constants/stream-service.ts` (new)
  Create a new `as const` object + derived type exactly matching the existing convention in `constants/stream-data-types.ts`: `StreamService = { STATE: 'state', INSTRUCTION: 'instruction', BIO: 'bio', SYNC: 'sync' } as const` plus `export type StreamService = (typeof StreamService)[keyof typeof StreamService]`. See spec §1.

- [x] **Task 2: Restructure `ActiveStreamRegistry` to a nested single-slot map with eviction** (depends on Task 1)
  Files: `src/realtime/services/active-stream-registry.service.ts`
  Replace `Map<string, Set<Subscriber<any>>>` with `Map<userId, Map<StreamService, Subscriber<any>>>` plus a `WeakSet<Subscriber<any>>` (`evictedSubscribers`). Per spec §2 (use its code block verbatim):
  - `register(userId, service, subscriber, onEvict?)` — if a **different** subscriber already occupies `(userId, service)`: add it to `evictedSubscribers`, fire `onEvict?.(existing)`, then `existing.complete()` (synchronous), then store the new subscriber. The `existing !== subscriber` reference check is mandatory (guards same-reference re-register self-eviction; also means it fires no `onEvict`).
  - `deregister(userId, service, subscriber): boolean` — returns `wasEvicted` via `WeakSet.prototype.delete`; only clears the slot when `serviceMap?.get(service) === subscriber` (defensive stale-deregister guard); prune empty inner maps.
  - `size`, `hasLiveSubscriber(userId)`, `closeAll(userId)`, `onModuleDestroy()` keep their **existing signatures** and sweep **all services** for the user. `closeAll`/`onModuleDestroy` must **not** touch `evictedSubscribers` (revocation/shutdown are not takeovers — their teardown must still report `wasEvicted: false`). See spec §2, §3 (race-safety rationale), and Guards.

### Phase 2: Engine takeover method

- [x] **Task 3: Add `ActivityEngine.supersedeChildren(userId)`** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.ts`
  New public async method ending every live child of the user as `INTERRUPTED` + `endedAt = now`, leaving the root untouched. Use the spec §6 code block verbatim. Critical ordering (spec §Safety-2): **clear the store synchronously first** — one `for` loop calling `this.activitySessionStore.removeChild(userId, child.sessionId)` for every child captured from `listChildren(userId)`, **before** any DB `await` — then a second loop that `repo.findOne`/sets `SessionStatus.INTERRUPTED` + `endedAt`/`repo.save`, fires `this.pushSessionEventMarker(saved.id, StreamSessionEvent.INTERRUPTED)` and `this.eventEmitter.emit(SessionEvents.INTERRUPTED, {...})` per child (mirror the payload shape used at `activity-engine.service.ts:465`). Do **not** reuse `stopActivity` per child (it re-reads the now-cleared store and would no-op). Do **not** add a new `SessionStatus`/`ActivityStatus` value. Skip children already gone from the DB (`if (!session) continue`). One lean summary log line (count + userId, no PII).

### Phase 3: Wire the controllers

- [x] **Task 4: Wire the STATE controller — `onEvict` frame + `wasEvicted` teardown branch** (depends on Tasks 2, 3)
  Files: `src/realtime/module-state.grpc.controller.ts`
  - Register site (`:145`): pass `StreamService.STATE` and an `onEvict` callback that pushes `evicted.next({ sessionError: { code: 'CONNECTION_SUPERSEDED', message: 'Superseded by a new connection', timestamp: Date.now() } })` — existing `StateErrorEvent` shape, plain literal code (same precedent as `'CANNOT_END_ROOT'`), no proto change. See spec §7.
  - Teardown block (`:243`): capture `const wasEvicted = this.activeStreamRegistry.deregister(userId, StreamService.STATE, subscriber)`; branch — `wasEvicted` → fire-and-forget `await this.activityEngine.supersedeChildren(userId)`; else → today's `await this.activityEngine.handleTransportDisconnect(userId)` **byte-for-byte unchanged**. Keep `rateLimiterService.evict`/`idempotency.evictUser` **unconditional** and last, ordering otherwise unchanged. Add `evicted=${wasEvicted}` to the existing disconnect log line. Use the spec §5 code block. Import `StreamService`.

- [x] **Task 5: Wire the instruction, bio, and sync controllers to their service key** (depends on Task 2)
  Files: `src/realtime/module-instruction-stream.grpc.controller.ts`, `src/realtime/module-biometric-stream.grpc.controller.ts`, `src/realtime/sync-stream.grpc.controller.ts`
  Add the `StreamService` middle argument (no `onEvict`) to each register + deregister call — instruction `:55`/`:135` → `StreamService.INSTRUCTION`; bio `:57`/`:75` → `StreamService.BIO`; sync `:49`/`:152` → `StreamService.SYNC`. These streams carry no session lifecycle — eviction is a bare `.complete()`, nothing else changes. Do **not** touch the adjacent `syncStreamService.deregister(userId, pushFn)` call (`sync-stream.grpc.controller.ts:153` — a different service). Import `StreamService` in each. See spec §4, §8.

## Commit Plan
- **Commit 1** (after tasks 1-5): "Add per-service last-connect-wins stream eviction with supersede-children takeover" — single atomic commit; all tasks ship together per the spec's atomicity gate.
