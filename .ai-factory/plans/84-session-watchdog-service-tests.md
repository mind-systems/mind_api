# Test Plan: Session Watchdog Service Tests

## Context
`SessionWatchdogService` periodically sweeps the `module_sessions` table for stale ACTIVE/DISCONNECTED sessions and reaps them (abandon via `ActivityEngine`, close streams via `ActiveStreamRegistry`), unless a live subscriber is present. No spec exists yet; this plan covers `sweep()` behavior and the bootstrap/shutdown timer lifecycle.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/realtime/services/session-watchdog.service.spec.ts`

## Target Spec File
`src/realtime/services/session-watchdog.service.spec.ts`

## Test Setup Notes (for the implementer)
- Construct the service directly: `new SessionWatchdogService(repo, activityEngine, activeStreamRegistry, configService)` — follow the plain-mock style of `startup-recovery.service.spec.ts` (no Nest `Test` module).
- Mocks:
  - `repo`: `{ find: jest.fn() }` typed as `Repository<ModuleSession>` via `as any`.
  - `activityEngine`: `{ abandonStale: jest.fn().mockResolvedValue(undefined) }` — signature `abandonStale(userId, sessionId): Promise<void>`.
  - `activeStreamRegistry`: `{ hasLiveSubscriber: jest.fn(), closeAll: jest.fn() }` — `closeAll` is **synchronous** (returns `void`), so do NOT mock it as resolving a promise.
  - `configService`: `{ get: jest.fn() }`. The constructor reads `WS_SESSION_MAX_IDLE_MS` (default `600_000`) and `WS_SESSION_SWEEP_INTERVAL_MS` (default `60_000`). Make `get` return the provided default (the 2nd argument) so tests run with known values, e.g. `get: jest.fn((_key, def) => def)`. To test a custom idle window, return an explicit number for `WS_SESSION_MAX_IDLE_MS`.
- Deterministic threshold: `jest.spyOn(Date, 'now').mockReturnValue(<fixedMs>)` so `threshold = new Date(now - maxIdleMs)` is predictable. Restore in `afterEach` (`jest.restoreAllMocks()`).
- A session-row factory (mirror `makeSession` in `startup-recovery.service.spec.ts`): build a `ModuleSession`-shaped object with `id`, `userId`, `status`, and a `lastActivityAt: Date`. `sweep` reads `row.id`, `row.userId`, `row.lastActivityAt.getTime()`.
- For lifecycle tests use `jest.spyOn(global, 'setInterval')` / `jest.spyOn(global, 'clearInterval')`. `jest.useFakeTimers()` is optional for the lifecycle group; `sweep()` is public so it can be called directly without advancing any timer.

## Tasks

### Phase 1: SessionWatchdogService — sweep query & empty result

- [x] **Task 1: `sweep` query construction and empty-result short-circuit**
  Files: `src/realtime/services/session-watchdog.service.spec.ts`
  Test cases:
  - `should query repo.find with status In([ACTIVE, DISCONNECTED]) and lastActivityAt LessThan(threshold)` — assert `repo.find` called with a `where` containing the `In(['active','disconnected'])` operator and a `LessThan` operator built from `Date.now() - maxIdleMs` (verify the threshold value derives from the mocked `Date.now` and configured idle window)
  - `should compute the threshold from a custom WS_SESSION_MAX_IDLE_MS when configured` — configure a non-default idle value and assert the `LessThan` threshold reflects it
  - `should return early and not call activityEngine.abandonStale or activeStreamRegistry methods when repo.find resolves to an empty array`

### Phase 2: SessionWatchdogService — reaping behavior

- [x] **Task 2: reaping stale sessions**
  Files: `src/realtime/services/session-watchdog.service.spec.ts`
  Test cases:
  - `should call activityEngine.abandonStale(userId, id) for each stale session` — single stale row, assert called once with the row's `userId` and `id`
  - `should call activeStreamRegistry.closeAll(userId) after abandonStale for a reaped session` — assert `closeAll` invoked with the row's `userId`
  - `should reap every stale session when multiple rows are returned` — multiple rows, assert `abandonStale` and `closeAll` called once per row
  - `should check hasLiveSubscriber before reaping each session` — assert `hasLiveSubscriber` called with each row's `userId`

- [x] **Task 3: live-subscriber skip path**
  Files: `src/realtime/services/session-watchdog.service.spec.ts`
  Test cases:
  - `should skip a session and not call abandonStale or closeAll when hasLiveSubscriber returns true for that userId`
  - `should reap only the rows without a live subscriber when a mix of rows is returned` — `hasLiveSubscriber` true for some userIds, false for others; assert reap calls happen only for the false ones

### Phase 3: SessionWatchdogService — per-row error isolation

- [x] **Task 4: per-row error isolation**
  Files: `src/realtime/services/session-watchdog.service.spec.ts`
  Test cases:
  - `should continue reaping remaining sessions when abandonStale rejects for one row` — make `abandonStale` reject for the first row and resolve for the second; assert the second row is still abandoned and its `closeAll` is called, and `sweep` resolves without throwing
  - `should not call closeAll for a row whose abandonStale rejected` — assert `closeAll` was not invoked for the failing row's `userId`
  - `should resolve (not reject) when every row fails to reap` — all `abandonStale` calls reject; assert `sweep()` still resolves

### Phase 4: SessionWatchdogService — lifecycle

- [x] **Task 5: bootstrap and shutdown timer management**
  Files: `src/realtime/services/session-watchdog.service.spec.ts`
  Test cases:
  - `should start a setInterval with the configured sweep interval on onApplicationBootstrap` — assert `setInterval` called with the `WS_SESSION_SWEEP_INTERVAL_MS` value (default `60_000`)
  - `should clear the sweep timer on onApplicationShutdown` — call bootstrap then shutdown; assert `clearInterval` called with the timer handle returned by `setInterval`
  - `should not call clearInterval on onApplicationShutdown when the timer was never started` — call shutdown without bootstrap; assert `clearInterval` not called
  - `should invoke sweep when the interval callback fires` — capture the callback passed to `setInterval`, spy on `service.sweep` (resolve it), invoke the callback, and assert `sweep` was called
