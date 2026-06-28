# Plan: State controller — concurrent starts + session_id routing + idempotency dedup

## Context
Make concurrent activities usable end-to-end at the controller layer: drop the singleton "existing → return" guard in `handleActivityStart`, route `end/stop/pause/resume` to `cmd.session_id` (sole-child fallback, else `AMBIGUOUS_SESSION`), add a short-window `(userId, client_activity_id) → sessionId` idempotency map, and fan `handleSessionRevoked` out across every live session (root + children). Spec: `.ai-factory/notes/06-state-controller-concurrent-idempotency.md`. The committed test contract this plan must turn GREEN is `src/realtime/concurrency-idempotency.spec.ts`.

### Blocking decisions / reconciliations (verified against the real code — the note's inlined contracts were partly stale)
1. **`endActivity` arg order must be reordered (GAP-B is real and unresolved upstream).** The note pins `endActivity(userId, sessionId, clientTimestampMs)` and the committed test asserts the controller calls `endActivity('user-1', 'session-A', undefined)` (`concurrency-idempotency.spec.ts:470-474`). But the **actual** engine signature today is `endActivity(userId, clientTimestampMs?, sessionId?)` (`activity-engine.service.ts:168-172`) — task 03 kept `clientTimestampMs` second and appended `sessionId` third. The test mock is order-agnostic, so a naive controller change would make the test pass while **silently breaking production**: the resolved `sessionId` would land in the `clientTimestampMs` slot, `getSoleChild` would return `undefined` for >1 child, and `endActivity` would return `null` — i.e. ending a specific child in the concurrent scenario this milestone enables would be a no-op. **Resolution:** reorder the engine signature to `endActivity(userId, sessionId?, clientTimestampMs?)` and migrate **all** call sites that pass a timestamp into the 2nd slot in lockstep — both the three direct calls in `activity-engine.service.spec.ts` (lines 227, 253, 282) **and** the `makeHelpers.end` wrapper in `multi-session-lifecycle.spec.ts` (lines 108-109), which a "GREEN now, must survive" characterization test exercises (`:550` passes a `coerceClientTs` Long-like object into the 2nd slot). Timestamp assertions stay unchanged — the value moves to the 3rd positional arg, `sessionId` passed `undefined`. The only **production** caller of `endActivity` is the controller (verified via grep). `stopActivity/pauseActivity/unpauseActivity` are already `(userId, sessionId?)` — no reorder needed.
2. **Two engine accessors the controller needs do not exist yet.** The controller (per test) calls `activityEngine.getSoleChild(userId)` and `activityEngine.listLiveSessions(userId)`. The engine currently exposes only `getActiveSession` (which internally returns `store.getSoleChild`). Both public methods must be **added** to `ActivityEngine`, delegating to the store (`store.getSoleChild`, and `store.getRoot` + `store.listChildren` for live sessions). `getActiveSession` stays untouched.
3. **Idempotency map must be controller-internal — NOT a new injected service.** The note suggests "a new service mirroring `RateLimiterService`", but the committed test instantiates the controller with **exactly the current 5 constructor args** (`concurrency-idempotency.spec.ts:212-218`). Adding a 6th DI-injected dependency would leave it `undefined` under the test and crash. Implement the map as a controller-owned helper instantiated as a field (`private readonly idempotency = new ...()`), not constructor-injected, so the constructor signature is unchanged.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Constants & config

- [x] **Task 1: Add `AMBIGUOUS_SESSION` error code**
  Files: `src/realtime/constants/ws-error-codes.ts`
  Add `AMBIGUOUS_SESSION: 'AMBIGUOUS_SESSION'` to the `WsErrorCode` object (value identical to key, SCREAMING_SNAKE — same template as the existing controller-emitted codes `RATE_LIMIT_EXCEEDED`, `SESSION_MISMATCH`). The committed test references the literal string `'AMBIGUOUS_SESSION'` (`concurrency-idempotency.spec.ts:530`).

- [x] **Task 2: Add `IDEMPOTENCY_WINDOW_MS` config key**
  Files: `src/realtime/constants/realtime-config.ts`
  Add `IDEMPOTENCY_WINDOW_MS: 'WS_IDEMPOTENCY_WINDOW_MS'` to the `RealtimeConfig` object, following the existing `WS_*` naming. Read in the controller with default `10_000` (test mock returns `10_000` for this exact key — `concurrency-idempotency.spec.ts:109`).

### Phase 2: Engine API (resolve GAP-B + add accessors)

- [x] **Task 3: Reorder `endActivity` and add `getSoleChild` + `listLiveSessions` to the engine**
  Files: `src/realtime/services/activity-engine.service.ts`, `src/realtime/services/activity-engine.service.spec.ts`, `src/realtime/services/multi-session-lifecycle.spec.ts`
  - Reorder `endActivity` from `(userId, clientTimestampMs?, sessionId?)` to **`(userId, sessionId?, clientTimestampMs?)`** (see Blocking decision 1). Inside the body, the `sid` resolution (`sessionId ?? store.getSoleChild(userId)?.sessionId`) and `coerceClientTs(clientTimestampMs)` usage stay the same — only the parameter positions swap. Keep the `number | { toNumber?(): number } | string` union on `clientTimestampMs`.
  - Update the three committed call sites in `activity-engine.service.spec.ts` (lines 227, 253, 282) to pass the timestamp in the **3rd** position with `sessionId = undefined`: `engine.endActivity('user-1', undefined, clientEndTs)` / `engine.endActivity('user-1', undefined, 0)`. Assertions about `endedAt` behaviour are unchanged.
  - Update the `makeHelpers.end` wrapper in `multi-session-lifecycle.spec.ts` (lines 108-109) to `engine.endActivity(userId, undefined, clientTimestampMs)`. This single change covers both `h.end('user-1')` (line 276) and `h.end('user-1', longLike)` (line 550 — the "GREEN now, must survive" `coerceClientTs` Long-branch characterization test); the userId-only direct call at line 836 is unaffected. Without this fix the `longLike` object would land in the `sessionId` slot, `endActivity` returns `null`, and `:552` (`endedAt`) goes red — a Class-B regression in Commit 1.
  - Both spec edits are mechanical signature migrations that preserve the asserted behaviour.
  - Add `getSoleChild(userId: string): ActivityState | undefined` → `return this.activitySessionStore.getSoleChild(userId)`.
  - Add `listLiveSessions(userId: string): ActivityState[]` returning root + all children: read `store.getRoot(userId)` and `store.listChildren(userId)`, return `root ? [root, ...children] : [...children]`. (`listChildren` already excludes root.)

### Phase 3: Idempotency store

- [x] **Task 4: Add the idempotency map helper**
  Files: `src/realtime/services/activity-idempotency.store.ts` (new)
  Plain class (NO `@Injectable` — it is instantiated directly, not a DI provider; see Blocking decision 3) mirroring `RateLimiterService` shape: a private `Map<string, { sessionId: string; storedAt: number }>` and:
  - `lookup(key: string, windowMs: number): string | undefined` — return the stored `sessionId` only if `Date.now() - entry.storedAt < windowMs`, else `delete` the entry and return `undefined` (same staleness check as `RateLimiterService.consume`).
  - `record(key: string, sessionId: string): void` — store `{ sessionId, storedAt: Date.now() }`.
  - `evictUser(userId: string): void` — delete every key with prefix `` `${userId}:` `` (teardown does not know the individual tokens; per-user prefix eviction satisfies the teardown test and multi-token users).

### Phase 4: Controller wiring

- [x] **Task 5: Rework `handleActivityStart` — remove guard + idempotency dedup; read window in constructor**
  Files: `src/realtime/module-state.grpc.controller.ts`
  - Add a private field `private readonly idempotency = new ActivityIdempotencyStore()` and `private readonly idempotencyWindowMs`, set in the constructor via `configService.get<number>(RealtimeConfig.IDEMPOTENCY_WINDOW_MS, 10_000)` (mirror the existing `rateLimitWindowMs` read; do **not** add a constructor parameter).
  - **Remove the singleton guard** (the `getActiveSession` block at lines 284-293) entirely — concurrent children are allowed.
  - Keep the rate-limit check **first**, then the idempotency lookup (intentional: per the note the rate limiter "caps creation regardless of tokens", so a true retry still consumes one `activity-start:${userId}` token before being deduped — the committed test is isolated from rate limiting so this ordering is safe). Do **not** move the lookup ahead of `consume`.
  - After the rate-limit check: if `cmd.clientActivityId` is set, build `` key = `${userId}:${cmd.clientActivityId}` ``; on `idempotency.lookup(key, this.idempotencyWindowMs)` hit, emit `sessionState { moduleSessionId: cachedId, status: ACTIVE }` and `return` (no `startActivity`).
  - After a successful `startActivity`, if `cmd.clientActivityId` is set, `idempotency.record(key, session.id)`. Missing `clientActivityId` → always create (back-compat).
  - In the teardown block (after `rateLimiterService.evict(...)`, ~line 196) add `this.idempotency.evictUser(userId)`.
  - After removing the guard here (and rewriting `handleSessionRevoked` in Task 7), `activityEngine.getActiveSession` has no remaining controller caller. The engine method itself stays (used elsewhere); just confirm no dangling reference is left in the controller (ESLint `no-unused-vars` will flag it if so).

- [x] **Task 6: session_id routing for end/stop/pause/resume + shared resolver** (depends on Task 3)
  Files: `src/realtime/module-state.grpc.controller.ts`
  - Import the cmd types `ActivityEndCmd`, `ActivityStopCmd`, `ActivityPauseCmd`, `ActivityResumeCmd` from `../../proto/generated/module_state` (each carries optional `sessionId`).
  - In `routeCommand`, pass the **whole cmd object** to each handler instead of just `clientTimestampMs`: `handleActivityEnd(userId, msg.activityEnd, subscriber)`, `handleActivityStop(userId, msg.activityStop, subscriber)`, `handleActivityPause(userId, msg.activityPause, subscriber)`, `handleActivityResume(userId, msg.activityResume, subscriber)`.
  - Add a private resolver `resolveTargetSession(userId, explicitSessionId, subscriber)`:
    1. `explicitSessionId !== undefined` → `{ ok: true, sessionId: explicitSessionId }`.
    2. else `getSoleChild(userId)` truthy → `{ ok: true, sessionId: sole.sessionId }`.
    3. else children = `listLiveSessions(userId).filter(s => s.activityType !== InternalActivityType.ROOT)`; if `children.length > 1` → emit `sessionError { code: WsErrorCode.AMBIGUOUS_SESSION, ... }` and return `{ ok: false }` (do NOT call any engine mutator).
    4. else (0 children) → `{ ok: true, sessionId: undefined }` (let the engine return `null` / throw `no_active_session`, preserving the current no-session behaviour at line 375).
  - Each handler calls the resolver; if `!ok` return. Then:
    - `handleActivityEnd` → `endActivity(userId, sid, cmd.clientTimestampMs)` (note the reordered signature from Task 3).
    - `handleActivityStop` → `stopActivity(userId, sid)`.
    - `handleActivityPause` → `pauseActivity(userId, sid)` (keep the existing try/catch → `sessionError` mapping).
    - `handleActivityResume` → `unpauseActivity(userId, sid)` (keep try/catch).

- [x] **Task 7: `handleSessionRevoked` fan-out across all live sessions** (depends on Task 3)
  Files: `src/realtime/module-state.grpc.controller.ts`
  Replace the single `getActiveSession` + `stopActivity(userId)` body: enumerate `this.activityEngine.listLiveSessions(payload.userId)`; for each session capture its `sessionId`, then `await stopActivity(payload.userId, sessionId)` inside a try/catch that logs and emits `SessionEvents.REVOKED { sessionId }` on failure (per-session). After the loop, call `this.activeStreamRegistry.closeAll(payload.userId)` exactly once (keep the existing line). Test expects 3 `stopActivity` calls with `(userId, sessionId)` and `closeAll` once (`concurrency-idempotency.spec.ts:544-574`).

### Phase 5: Migrate the old characterization suite

- [x] **Task 8: Migrate anti-target tests in the old controller spec** (depends on Tasks 5-7)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Per the note's "Anti-targets" section — these assert the old singleton/userId-only behaviour and must be reconciled so they fail only for the right reason:
  - **DELETE** the singleton-guard echo tests: `should emit sessionState ACTIVE with existing moduleSessionId ...` (~:652-663), `should not call activityEngine.startActivity when an active session already exists` (~:665-675), `should omit the isPaused field ... when returning an existing session` (~:760-771).
  - **INVERT/UPDATE** the routing chars to the new call shapes: `endActivity` → `('user-1', undefined, undefined)` (sole-child resolves to `undefined` here since the mock engine has no children; ~:777-787); `stopActivity` → `('user-1', undefined)` (~:829-836); `pauseActivity` → `('user-1', undefined)` (~:881-892); `unpauseActivity` → `('user-1', undefined)` (~:947-958).
  - **UPDATE** `handleSessionRevoked › should call activityEngine.stopActivity(payload.userId)` (~:567-569) to the fan-out contract: `stopActivity('user-1', 'session-1')`.
  - **Mock `listLiveSessions` with a one-session array, NOT `[]`** (decision for Minor Issue 2): set the old-suite mock engine's `listLiveSessions: jest.fn().mockReturnValue([{ sessionId: 'session-1', activityType: 'breath' }])`. An empty array would make `handleSessionRevoked` never call `stopActivity`, silently neutering the three revoke error-path chars at `:578` (`closeAll even when stopActivity throws`), `:584` (`should not rethrow when stopActivity rejects`), and `:589` (`should call stopActivity before closeAll`) — they would pass vacuously. A one-session array keeps the throw-path (`stopActivity.mockRejectedValue`) and call-order coverage meaningful while still satisfying the updated `:567` assertion.
  - The four routing chars use a mock engine (controller.spec.ts:28-39) with no `getSoleChild`/`listLiveSessions`; add `getSoleChild: jest.fn().mockReturnValue(undefined)` and the `listLiveSessions` mock above so the resolver's absent-`sessionId` path yields `(userId, undefined)` instead of throwing.

## Commit Plan
- **Commit 1** (after tasks 1-4): "Add ambiguous-session code, idempotency window config, engine accessors and reordered endActivity"
- **Commit 2** (after tasks 5-7): "Concurrent starts, session_id routing and revoke fan-out in state controller"
- **Commit 3** (after task 8): "Migrate state-controller characterization tests to multi-session contract"
