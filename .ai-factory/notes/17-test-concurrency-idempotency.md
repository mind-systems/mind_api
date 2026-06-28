# Test plan — concurrent activities + idempotency dedup (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[06-state-controller-concurrent-idempotency]] (proto dep [[05-proto-session-id-idempotency]]).

## Test authoring constraints (the four lessons)
- **L1 — outcomes only:** assert observable OUTPUTS — the emitted `StateResponse` `moduleSessionId` / `sessionError.code` on the captured subscriber — never the internal `(userId, clientActivityId) → sessionId` map; spec 06 owns that structure. "Revoke stops all" asserts `stopActivity` invoked per sessionId + `closeAll(userId)` called, NOT any collection's contents.
- **L2 — compile-now:** new proto fields via `(cmd as any).clientActivityId` / `(cmd as any).sessionId`; new engine methods via `(engine as any).<method>`; the error code as the **string literal** `'AMBIGUOUS_SESSION'` (never the constant); the config key as the **string literal** `'WS_IDEMPOTENCY_WINDOW_MS'` (never `RealtimeConfig.IDEMPOTENCY_WINDOW_MS`, which does not exist yet — importing it would red-compile the whole file instead of cleanly RED-ing per case). `clientTimestampMs` is typed `number` (`activity-start.dto.ts:14`, `module_state.ts:57`) — plain number, no `Long` fixture.
- **L3 — label by spec name:** mark cases `RED until spec 06-state-controller-concurrent-idempotency` (proto dep `spec 05-proto-session-id-idempotency`). Never a phase number.
- **L4 — escalation valve:** this suite has BOTH categories (see Red/Green). Before escalating a post-spec-06 CHARACTERIZATION RED as a Class-B regression, confirm it asserts an invariant OUTCOME, not a removed internal — if the latter, it was mis-classified → move to TARGET, do not escalate.

## Why this area (silent-failure filter)
Dedup-with-wrong-key and command-routing are textbook silent bugs: a retried `activity:start` creating a duplicate session, an idempotency key colliding across users, or `pause` routed to the wrong child — none throw, they corrupt session/stat data. The one loud path (`AMBIGUOUS_SESSION`) must also be asserted so it does not silently fall back to the wrong child.

## Behavior under change — think hard before writing
The old singleton guard (`existing → return`, `module-state.grpc.controller.ts:281-290`) did double duty: it blocked concurrency AND deduped retries. Spec 06 removes it and splits those into two mechanisms (a session_id-addressed router + a token dedup map). **Critical trap (cost 3 plan rounds):** the controller keeps NO active-session state of its own — it delegates to `activityEngine.getActiveSession(userId)`, and a mock `startActivity` does NOT update what `getActiveSession` returns. So with the default `getActiveSession=undefined` mock the guard NEVER fires and concurrent starts already produce distinct children TODAY. Cases that don't wire `getActiveSession` to an active session are GREEN now, not RED — they must be classified CHARACTERIZATION, or the wiring must force the guard to fire.

## Red/Green contract — TWO categories (do NOT mark everything TARGET)
Mirror `multi-session-lifecycle.spec.ts`'s two-category header. Today the controller has **no** dedup map, so a repeat token simply starts a fresh session — the "absence of dedup" cases pin behavior spec 06 must **preserve**, not introduce.

- **TARGET [RED until spec 06]** — genuinely new behavior: within-window dedup; the two guard-removal concurrency cases (only RED if `getActiveSession` is wired active — see trap above); session_id routing; `AMBIGUOUS_SESSION`; revoke-stops-all. Must NOT be `.skip`/`.todo`/`it.failing`; red-for-the-right-reason is the done state.
- **CHARACTERIZATION [GREEN now, must survive spec 06]** — preservation: after-window → new session; per-user token scoping; absent-token → always create; teardown eviction. A RED here after spec 06 is a regression (Class B) → escalate, do not patch. (Note: per-user-scoping and teardown-eviction are *weak* signals today — they pass trivially because no dedup map exists; they only become meaningful after spec 06. Acceptable as preservation pins; do not read their GREEN-today as proof the behavior is exercised.)

## Instantiation
New spec file (own file, mirrors how the sibling created `multi-session-lifecycle.spec.ts`). Instantiate `new ModuleStateGrpcController(activityEngine, rateLimiterService, activeStreamRegistry, configService, eventEmitter)` (arg order `module-state.grpc.controller.ts:70-76`); reuse `makeActivityEngine`/`makeRateLimiterService`/`makeActiveStreamRegistry`/`makeEventEmitter`/`makeUser`/`makeActivityState`/`flushMicrotasks` from `module-state.grpc.controller.spec.ts`. Required fixture overrides (each closes a wrong-reason failure):
- **Config mock must be key-aware** — do NOT copy `makeConfigService`'s flat `mockReturnValue(10)` (returns `10` for every key → the 10 000 ms window collapses to 10 ms and `advanceTimersByTime` overshoots 1000×). Use `get: jest.fn((key, def) => key === 'WS_IDEMPOTENCY_WINDOW_MS' ? 10_000 : def ?? 10)`.
- **`startActivity` yields distinct ids per call** (incrementing `session-1`, `session-2`, …) — the default constant `{ id: 'session-1' }` makes "two distinct ids" unprovable.
- **`activityStart` builder defaults `activityType: ActivityType.BREATH`** — proto default `0`/`ACTIVITY_TYPE_UNSPECIFIED` makes `mapProtoActivityType` throw → `INVALID_ACTIVITY_TYPE` and `startActivity` never called (wrong-reason failure).
- **Mock `rateLimiterService.consume → true`** to isolate dedup from rate limiting.
- Drive via `trackActivity(request$, user)` with a `Subject<StateRequest>`; capture every `StateResponse` into `values: StateResponse[]`.

## Test cases (with category)
### Concurrent start — TARGET [RED until 06], requires guard wired active
- should create two distinct children for two starts with different `clientActivityId` — wire `getActiveSession.mockReturnValueOnce(undefined).mockReturnValue(makeActivityState({ sessionId: 'session-1' }))`; today guard echoes `session-1` (one `startActivity`) → RED; after 06 two children → GREEN.
- should NOT echo the active session on a second start — `getActiveSession.mockReturnValue(makeActivityState({ sessionId: 'session-1' }))`; today echoes → RED; after 06 new child → GREEN.
### Idempotency (fake timers scoped to this block only)
- **TARGET** — repeat `clientActivityId` within window → same `moduleSessionId`, `startActivity` once.
- **CHARACTERIZATION** — repeat after window → new session: advance `10_001` ms (window + 1, see Gotchas) → new `startActivity`, different id.
- **CHARACTERIZATION** — per-user token scoping: same token, different `user.sub` → different session.
- **CHARACTERIZATION** — absent `clientActivityId` → always create.
- **CHARACTERIZATION** — token map evicted on stream teardown (unsubscribe) → repeat token after a new connection starts fresh (driven by teardown, not time).
### session_id routing — TARGET [RED until 06]
- should route pause/resume/end/stop to the child named by `(cmd as any).sessionId` (asserted as the **second positional arg** of the engine call — see forward-coupling) while siblings stay untouched.
- should fall back to the sole child when `sessionId` absent and exactly one child exists (`getSoleChild` returns it).
- should emit `sessionError.code === 'AMBIGUOUS_SESSION'` when `sessionId` absent and >1 child active — assert the literal string AND that no handler is silently invoked on any child.
### Revoke — TARGET [RED until 06]
- should stop every live session (root + each child) then `closeAll(userId)` — assert the OUTCOME (`stopActivity(userId, sessionId)` per live sessionId + `closeAll`), never an internal map.

## Forward-coupling contracts spec 06 must honor (the test invents these names → they are a hard contract)
- **Error code:** add `AMBIGUOUS_SESSION: 'AMBIGUOUS_SESSION'` to `src/realtime/constants/ws-error-codes.ts` (SCREAMING_SNAKE, value === key).
- **Config window:** add `WS_IDEMPOTENCY_WINDOW_MS` to `RealtimeConfig`, read via `configService.get('WS_IDEMPOTENCY_WINDOW_MS', 10_000)`, default `10_000` (locked in [[06-state-controller-concurrent-idempotency]]). ROADMAP only promises "a short-window map" — this test fixes it as config-driven, so spec 06 must read the key (not hardcode) or the key-aware mock is never consulted.
- **Engine enumerator:** `(engine).listLiveSessions(userId)` → live sessions (root + children), each `{ sessionId, activityType }` — used by revoke + ambiguity/sole-child resolution.
- **Sole-child resolver:** `(engine).getSoleChild(userId)` → the one live child or `undefined`.
- **`sessionId` second-positional threading:** `endActivity(userId, sessionId, clientTimestampMs)`, `stopActivity(userId, sessionId)`, `pauseActivity(userId, sessionId)`, `unpauseActivity(userId, sessionId)` (today all `userId`-only). This ripples into `activity-engine.service.ts` and the sibling `multi-session-lifecycle.spec.ts` `makeHelpers` (2-arg forwarders) — spec 06 must update them in lockstep.
- **Revoke fan-out:** `handleSessionRevoked` enumerates `listLiveSessions(userId)` and `stopActivity(userId, sessionId)` per session, then `closeAll(userId)` (today a single `stopActivity(userId)`).
- **Anti-target (must invert, not preserve):** `module-state.grpc.controller.spec.ts:652-675` has two GREEN-today tests asserting the singleton-guard behavior ("emit ACTIVE with existing id when getActiveSession returns a session"; "do not call startActivity when active session exists"). Spec 06 REMOVES that guard, so these two must be **deleted/inverted** by spec 06 — they encode soon-to-be-removed behavior and are NOT characterization-to-preserve. Their post-06 RED is intended; do not escalate.

## Exact pins (read from source)
- Singleton guard to remove: `module-state.grpc.controller.ts:281-290` (`getActiveSession(userId)` → `existing → next(ACTIVE) → return`).
- `getActiveSession` mock default is `undefined` (`module-state.grpc.controller.spec.ts:31`); the active-session fixture pattern is `getActiveSession.mockReturnValue(makeActivityState({ sessionId: 'session-1' }))` (`:653`, `:666`).
- `makeConfigService` flat mock: `module-state.grpc.controller.spec.ts:57-60`.
- `handleSessionRevoked({ userId })` is a public method, direct-callable (`:199`; existing spec call `:568`); today `stopActivity(userId)` + `closeAll(userId)` (`:202-213`).
- Errors are `subscriber.next({ sessionError: { code, message, timestamp } })`, NOT thrown (e.g. `RATE_LIMIT_EXCEEDED` at `:271-278`).
- `RateLimiterService.consume(key, limit, windowMs)` (`rate-limiter.service.ts:12`), key `activity-start:${userId}` (`:266`).

## Gotchas
- Fake timers **scoped to the idempotency describe block only** (`jest.useFakeTimers()` in `beforeEach`, `useRealTimers()` in `afterEach`) — do not enable globally, it interferes with the promise-based `setup()` flow in other blocks. `flushMicrotasks` (`await Promise.resolve()`) still works under fake timers.
- After-window case: advance by **`10_001`** (window + 1 ms), not `10_000` — a `> window` expiry leaves the token still valid at exactly `10_000`, turning the characterization RED for an off-by-one reason. (Pin the expiry comparison in spec 06's note if exact-boundary semantics matter.)

## Findings
_(fill during test-writing; escalate to [[06-state-controller-concurrent-idempotency]] before implementing it)_
