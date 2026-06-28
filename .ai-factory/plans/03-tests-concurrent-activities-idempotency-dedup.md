# Plan: Tests — concurrent activities + idempotency dedup

## Context
Author the TDD test suite (silent-bug-first) for the upcoming concurrent-activities + idempotency-dedup feature: it guards duplicate-session-on-retry, cross-user token collision, command routed to the wrong child, and asserts `AMBIGUOUS_SESSION` never silently picks a child. Cases split into two categories (mirroring `multi-session-lifecycle.spec.ts`): **TARGET** (new behavior, RED until feature spec `06-state-controller-concurrent-idempotency` lands — proto fields depend on `05-proto-session-id-idempotency`) and **CHARACTERIZATION** (behavior that already holds today and that spec 06 must **preserve**, GREEN now and must survive 06).

**Compile-before-feature discipline:** the file must NOT import or reference any symbol that specs 05/06 add. Access not-yet-existing proto fields via `(cmd as any).clientActivityId` / `(cmd as any).sessionId`, not-yet-existing engine methods via `(engine as any).<method>`, the new error code as the **string literal** `'AMBIGUOUS_SESSION'` (never the constant), and the new config key as the **string literal** `'WS_IDEMPOTENCY_WINDOW_MS'` (never `import { RealtimeConfig }` / `RealtimeConfig.IDEMPOTENCY_WINDOW_MS`, which does not exist yet and would turn the whole file into a red compile instead of clean per-case RED).

## Settings
- Testing: yes (this milestone IS the test suite — do not implement the feature)
- Logging: minimal
- Docs: no

## Forward-coupling requirements for spec 06 (state in the plan, do not implement here)
This test suite pins concrete contracts spec 06 must honor exactly — the test author invents the mock method names and the spec-06 controller must call those names/signatures for the suite to go GREEN. If spec 06 picks different names or keeps the `userId`-only signatures, the suite stays RED for the wrong reason. Record these so specs 05/06 do not drift:

- **Error code:** add `'AMBIGUOUS_SESSION'` to `src/realtime/constants/ws-error-codes.ts` (SCREAMING_SNAKE, value === key) and emit via `subscriber.next({ sessionError: { code: 'AMBIGUOUS_SESSION', … } })` when `sessionId` is absent and >1 child is active.
- **Idempotency window:** make it config-driven — add `WS_IDEMPOTENCY_WINDOW_MS` to `RealtimeConfig` (`IDEMPOTENCY_WINDOW_MS` accessor) and read it via `configService.get('WS_IDEMPOTENCY_WINDOW_MS', 10_000)`, default `10_000` ms. (ROADMAP line 43 only promises "a short-window map"; this test fixes it as config-driven with a 10 000 ms default.)
- **Live-session enumerator** (used by revoke + ambiguity/sole-child resolution): `(engine).listLiveSessions(userId)` → array of live sessions (root + children), each carrying at least `{ sessionId, activityType }`. The test accesses it via `(engine as any).listLiveSessions`; spec 03/06 must expose exactly this name.
- **Sole-child resolver** (used by the `sessionId`-absent single-child fallback): `(engine).getSoleChild(userId)` → the one live child or `undefined`. Accessed via `(engine as any).getSoleChild`.
- **`sessionId` threading into command handlers:** spec 06's controller must thread the resolved `sessionId` into the engine calls as the **second positional argument** — `endActivity(userId, sessionId, clientTimestampMs)`, `stopActivity(userId, sessionId)`, `pauseActivity(userId, sessionId)`, `unpauseActivity(userId, sessionId)` (today all are `userId`-only). The routing cases assert each method is called with the addressed `sessionId` in that position.
- **Revoke fan-out:** `handleSessionRevoked` must enumerate `listLiveSessions(userId)` and issue a `stopActivity(userId, sessionId)` for **every** live session (root + each child), then call `activeStreamRegistry.closeAll(userId)` (today it issues a single `stopActivity(userId)`). Task 6 asserts N per-session stop calls, not one stop-all.
- **Anti-target — existing guard tests spec 06 must invert, not preserve:** `module-state.grpc.controller.spec.ts:652-675` holds two GREEN-today tests asserting the singleton guard ("emit sessionState ACTIVE with existing moduleSessionId when getActiveSession returns a session"; "do not call activityEngine.startActivity when an active session already exists"). Spec 06 **removes** that guard, so these two tests must be **deleted/inverted by spec 06** — they encode soon-to-be-removed behavior and are *anti-target*, NOT characterization-to-preserve. Their post-06 RED is intended; a spec-06 implementer following the "characterization RED → escalate" rule must not misclassify them as a regression.

## Tasks

### Phase 1: Test harness

- [x] **Task 1: Create the spec file with a controller-level test harness**
  Files: `src/realtime/concurrency-idempotency.spec.ts`
  Create a new dedicated spec file (mirrors how the sibling task created `src/realtime/services/multi-session-lifecycle.spec.ts`). Instantiate `ModuleStateGrpcController` directly via `new ModuleStateGrpcController(activityEngine, rateLimiterService, activeStreamRegistry, configService, eventEmitter)` — reuse the mock-factory pattern from the existing `src/realtime/module-state.grpc.controller.spec.ts` (`makeActivityEngine`, `makeRateLimiterService`, `makeActiveStreamRegistry`, `makeEventEmitter`, `makeUser`, `makeActivityState`, `flushMicrotasks`).
  Make the config mock **default-respecting / key-aware** — do NOT copy `makeConfigService`'s flat `mockReturnValue(10)` (it returns `10` for every key, so the 10 000 ms window would collapse to 10 ms and `advanceTimersByTime` would overshoot 1000×). Use e.g. `get: jest.fn((key, def) => (key === 'WS_IDEMPOTENCY_WINDOW_MS' ? 10_000 : def ?? 10))`.
  Extend `makeActivityEngine` with the not-yet-existing accessors named in the forward-coupling section (`listLiveSessions`, `getSoleChild`), accessed via `(engine as any).<method>` so the file compiles before specs 05/06. Configure `startActivity` to return a **distinct session per call** (an implementation yielding incrementing ids `session-1`, `session-2`, … — not the default constant `{ id: 'session-1' }`) so "two distinct ids" is provable. Mock `rateLimiterService.consume` to return `true` so dedup is isolated from rate limiting.
  Add a top-of-file doc comment matching the sibling spec's **two-category** convention — do NOT claim every case is RED. Document both labels:
  - **TARGET [RED until spec 06-state-controller-concurrent-idempotency]** (proto dep `05-proto-session-id-idempotency`) — new behavior; must NOT be `.skip`/`.todo`/`it.failing`; genuine red-for-the-right-reason is the done state.
  - **CHARACTERIZATION [GREEN now, must survive spec 06]** — behavior that already holds today and that spec 06 must preserve; a RED here after spec 06 lands is a regression (Class B silent bug) → escalate, do not patch the test.

- [x] **Task 2: Add a subscriber-capture helper and request-oneof builders**
  Files: `src/realtime/concurrency-idempotency.spec.ts`
  Drive the controller through `trackActivity(request$, user)` with a `Subject<StateRequest>`, push crafted command oneofs, and capture every emitted `StateResponse` into a `values: StateResponse[]` array via `.subscribe({ next, error })` — exactly as the existing spec does. Provide small builders for the request oneofs:
  - `activityStart` — defaults `activityType: ActivityType.BREATH` (leaving it at the proto default `0`/`ACTIVITY_TYPE_UNSPECIFIED` makes `mapProtoActivityType` throw → `INVALID_ACTIVITY_TYPE` emitted and `startActivity` never called, a wrong-reason failure), sets `clientActivityId` via `(cmd as any).clientActivityId`, and a plain numeric `clientTimestampMs` (proto type is `number | undefined` — no `Long` fixture here).
  - `activityEnd` / `activityStop` / `activityPause` / `activityResume` — set `sessionId` via `(cmd as any).sessionId`.
  Assert only on observable outputs — `values[i].sessionState.moduleSessionId` and `values[i].sessionError.code` — never on any internal token/session map.

### Phase 2: Concurrent start + idempotency

- [x] **Task 3: Concurrent-start cases** (depends on Task 2)
  Files: `src/realtime/concurrency-idempotency.spec.ts`
  Two cases, both **TARGET [RED until 06]** — these exercise *removal of the singleton guard* at `module-state.grpc.controller.ts:281-290` (`getActiveSession` truthy → echo existing id → return). The controller keeps no active-session state of its own and a mock `startActivity` does not update what `getActiveSession` returns, so with the default `getActiveSession=undefined` mock the guard never fires and both cases would be GREEN today (no RED signal). To make them genuinely RED-until-06, wire `getActiveSession` to report an active session on the second start, mirroring the existing spec (`getActiveSession.mockReturnValue(makeActivityState({ sessionId: 'session-1' }))`, controller spec L653/L666):
  - should create two distinct children for two `activity:start` with different `clientActivityId`: set `getActiveSession.mockReturnValueOnce(undefined).mockReturnValue(makeActivityState({ sessionId: 'session-1' }))`. Assert two `startActivity` calls and two distinct `moduleSessionId`s. **Today (guard present):** start #2 echoes `session-1`, one `startActivity` → RED. **After 06 (guard removed):** two children → GREEN.
  - should NOT return an existing session just because one is already active: `getActiveSession.mockReturnValue(makeActivityState({ sessionId: 'session-1' }))`. Assert the second start still creates a new child rather than echoing the active id. **Today:** echoes `session-1` → RED. **After 06:** new child → GREEN.

- [x] **Task 4: Idempotency dedup cases** (depends on Task 3)
  Files: `src/realtime/concurrency-idempotency.spec.ts`
  Five cases, split TARGET vs CHARACTERIZATION (today the controller has **no** dedup map, so a repeat token simply starts a fresh session — the "absence of dedup" cases pin behavior spec 06 must preserve, not introduce). Scope **fake timers to this describe block only** — `jest.useFakeTimers()` in `beforeEach`, `jest.useRealTimers()` in `afterEach` (mirror `multi-session-lifecycle.spec.ts`; do not enable fake timers globally, to avoid interfering with the promise-based `setup()` flow in other phases; `flushMicrotasks` via `await Promise.resolve()` still works under fake timers). The window comes from the key-aware config mock returning `10_000` for `'WS_IDEMPOTENCY_WINDOW_MS'`. Keep `getActiveSession=undefined` here so the dedup map (not the removed guard) is what's under test:
  - **TARGET [RED until 06]** — should return the same `moduleSessionId` for a repeat `clientActivityId` **within** the window (`startActivity` called once). *Today:* starts twice → two ids → RED.
  - **CHARACTERIZATION [GREEN now, must survive 06]** — should create a **new** session for a repeat `clientActivityId` **after** the window: `jest.advanceTimersByTime(10_001)` (window + 1 ms — advancing by exactly `10_000` leaves the token valid under a `> window` expiry, turning this RED for an off-by-one reason rather than a real regression), then assert a second `startActivity` and a different `moduleSessionId`. *Today:* always starts → GREEN; spec 06's window expiry must keep it GREEN.
  - **CHARACTERIZATION** — should scope the token per user: same token from a different `user.sub` yields a different session (`startActivity` called for each user).
  - **CHARACTERIZATION** — should always create when `clientActivityId` is absent (back-compat — every call hits `startActivity`).
  - **CHARACTERIZATION** — should evict the token map on stream teardown (unsubscribe / disconnect) so a repeat token after a new connection is not silently deduped against the old one (assert via observable: a fresh `startActivity` is invoked; driven by teardown, not time).

### Phase 3: Routing + revoke

- [x] **Task 5: session_id routing cases** (depends on Task 4)
  Files: `src/realtime/concurrency-idempotency.spec.ts`
  Three cases, all **TARGET [RED until 06]** (today the handlers resolve by `userId` only — they ignore `sessionId` and have no sole-child / ambiguity logic). Build a multi-child scenario via `(engine as any).listLiveSessions` / `getSoleChild`:
  - should route `pause`/`resume`/`end`/`stop` to the child named by `(cmd as any).sessionId` while siblings stay untouched — assert each engine method is called with the addressed `sessionId` as the second positional argument (per the forward-coupling signatures), not a sibling's.
  - should fall back to the sole child when `sessionId` is absent and exactly one child exists (`getSoleChild` returns it).
  - should emit `sessionError.code === 'AMBIGUOUS_SESSION'` when `sessionId` is absent and >1 child is active — assert the literal string `'AMBIGUOUS_SESSION'` (do not import the constant) AND assert it does NOT silently invoke the handler on any child. Errors arrive via the captured `subscriber.next({ sessionError })` payload, not as throws.

- [x] **Task 6: Revoke case** (depends on Task 5)
  Files: `src/realtime/concurrency-idempotency.spec.ts`
  One case, **TARGET [RED until 06]** (today `handleSessionRevoked` issues a single `stopActivity(userId)`). Wire `(engine as any).listLiveSessions(userId)` to return a root + multiple live children, then trigger `controller.handleSessionRevoked({ userId })` directly. Assert the OUTCOME: a `stopActivity(userId, sessionId)` is invoked for **every** live `sessionId` (root + each child) and `activeStreamRegistry.closeAll(userId)` is called. Never assert any internal session-map contents (L1 — spec 06 owns that structure).

## Commit Plan
- **Commit 1** (after tasks 1-2): "Add concurrency/idempotency test harness and subscriber-capture helper"
- **Commit 2** (after tasks 3-4): "Add concurrent-start and idempotency dedup tests"
- **Commit 3** (after tasks 5-6): "Add session_id routing and revoke target tests"
