# Session Watchdog Service — Test Plan

**Date:** 2026-06-25
**Source:** roadmap-test-coverage agent

## Source Overview

`SessionWatchdogService` is a background watchdog that periodically scans the database for stale (idle) module sessions and reaps them. It implements NestJS lifecycle hooks to start/stop a recurring sweep interval on application bootstrap/shutdown. The service detects sessions that are either `ACTIVE` or `DISCONNECTED` with `lastActivityAt` older than a configurable threshold, skips sessions with active subscribers still connected, and calls `ActivityEngine.abandonStale()` to mark them as abandoned while closing all streams for that user via `ActiveStreamRegistry.closeAll()`.

## Instantiation

SessionWatchdogService requires:
- `Repository<ModuleSession>` (TypeORM injected via `@InjectRepository`)
- `ActivityEngine` (injected service)
- `ActiveStreamRegistry` (injected service)
- `ConfigService` (NestJS ConfigService)

**Testing approach:** Use direct instantiation with mocked dependencies (not the full NestJS Testing module, matching the pattern of other realtime service tests in the codebase).

**Mocks needed:**
- `Repository<ModuleSession>` — mock `find()` method to return stale sessions
- `ActivityEngine` — mock `abandonStale(userId: string, sessionId: string)` async method
- `ActiveStreamRegistry` — mock `hasLiveSubscriber(userId: string): boolean` and `closeAll(userId: string): void` methods
- `ConfigService` — mock `get<number>(key: string, defaultValue: number)` to control sweep interval and idle threshold

## Existing Coverage

None — no spec file exists for this service.

## Test Cases

### Constructor & Configuration

- **should initialize with default values when ConfigService returns undefined**
  - Method: `constructor`
  - Setup: Mock `configService.get()` to return `undefined` for both config keys
  - Assert: `maxIdleMs` defaults to 600_000, `sweepIntervalMs` defaults to 60_000

- **should initialize with custom values when ConfigService provides them**
  - Method: `constructor`
  - Setup: Mock `configService.get()` to return custom values (e.g., 300_000, 30_000)
  - Assert: Verify private fields hold the custom values by observing behavior in sweep()

### onApplicationBootstrap()

- **should set up a recurring interval on startup**
  - Method: `onApplicationBootstrap()`
  - Setup: Use `jest.useFakeTimers()`, call bootstrap, call sweep manually to verify timer fires
  - Assert: `setInterval` was called with correct sweep interval

- **should catch and log errors during periodic sweep**
  - Method: `onApplicationBootstrap()` → sweep loop
  - Setup: Mock `repo.find()` to throw an error, trigger the timer callback
  - Assert: Logger.error was called with 'Periodic watchdog sweep failed'

### onApplicationShutdown()

- **should clear the sweep timer on shutdown**
  - Method: `onApplicationShutdown()`
  - Setup: Call bootstrap, then shutdown
  - Assert: `clearInterval` was called with the stored timer ID (verify via spy on global clearInterval)

- **should handle shutdown gracefully when timer is undefined**
  - Method: `onApplicationShutdown()`
  - Setup: Skip bootstrap, directly call shutdown
  - Assert: No error thrown (sweepTimer is undefined, if-check passes)

### sweep() — Query Logic

- **should query sessions with ACTIVE or DISCONNECTED status and lastActivityAt before threshold**
  - Method: `sweep()`
  - Setup: Mock `repo.find()`, call sweep with fixed `Date.now()` value
  - Assert: `repo.find()` called with correct where clause: `{ status: In([ACTIVE, DISCONNECTED]), lastActivityAt: LessThan(threshold) }`

- **should calculate threshold correctly using maxIdleMs**
  - Method: `sweep()`
  - Setup: Mock `Date.now()` to return 1000000, set maxIdleMs to 100000, spy on repo.find()
  - Assert: Threshold passed to repo.find() is new Date(900000)

- **should return early if no stale sessions found**
  - Method: `sweep()`
  - Setup: Mock `repo.find()` to return empty array
  - Assert: `activityEngine.abandonStale()` never called, no logging of reaped count

### sweep() — Live Subscriber Logic

- **should skip sessions with active live subscribers**
  - Method: `sweep()`
  - Setup: Mock repo.find() to return 2 stale sessions (userId='u1', userId='u2'); mock hasLiveSubscriber('u1') to return true, hasLiveSubscriber('u2') to return false
  - Assert: abandonStale called once for u2 only; verbose log "Watchdog skipping sessionId=... — live subscriber present" logged once

- **should log verbose message when skipping due to live subscriber**
  - Method: `sweep()`
  - Setup: Create stale session with userId, mock hasLiveSubscriber to return true
  - Assert: Logger.verbose called with message containing "Watchdog skipping" and userId

### sweep() — Reaping Logic

- **should call activityEngine.abandonStale with correct userId and sessionId**
  - Method: `sweep()`
  - Setup: Create stale session with sessionId='s1', userId='u1', mock hasLiveSubscriber to return false
  - Assert: abandonStale called with ('u1', 's1')

- **should call activeStreamRegistry.closeAll after successful abandonStale**
  - Method: `sweep()`
  - Setup: Stale session with userId='u1', mock both services
  - Assert: closeAll('u1') called after abandonStale completes (verify call order)

- **should log warning with idleMs calculation**
  - Method: `sweep()`
  - Setup: Stale session with lastActivityAt = Date.now() - 50000, mock Date.now() to return fixed value
  - Assert: Logger.warn called with message containing "idleMs=50000"

- **should increment reaped counter for each successful reap**
  - Method: `sweep()`
  - Setup: 3 stale sessions, no live subscribers, mock all services to succeed
  - Assert: Final warning log shows "swept 3 stale sessions"

### sweep() — Error Handling

- **should catch exceptions from abandonStale and continue reaping other sessions**
  - Method: `sweep()`
  - Setup: 3 stale sessions; mock abandonStale to throw on first call, mock second and third to succeed
  - Assert: activeStreamRegistry.closeAll called only for sessions 2 and 3; Logger.error called for session 1; final log shows "swept 2 stale sessions"

- **should log error when abandonStale throws**
  - Method: `sweep()`
  - Setup: Stale session, mock abandonStale to throw error
  - Assert: Logger.error called with "Watchdog failed to reap sessionId=..."

- **should not stop reaping if closeAll throws**
  - Method: `sweep()`
  - Setup: Mock closeAll to throw, continue processing more sessions
  - Assert: Error logged (or propagates — confirm service behavior), subsequent sessions still processed

### sweep() — Integration

- **should reap 0 sessions when all have live subscribers**
  - Method: `sweep()`
  - Setup: 5 stale sessions, all have live subscribers
  - Assert: Logger.warn final message shows "swept 0 stale sessions"; abandonStale never called

- **should handle mixed scenario: some stale, some not; some skipped, some reaped**
  - Method: `sweep()`
  - Setup: Mock repo.find() to return 5 sessions; 2 with live subscribers, 3 without; mix of ACTIVE and DISCONNECTED statuses
  - Assert: reaped count = 3; logs show skips and warnings for reaped ones

- **should correctly calculate idleMs as current time minus lastActivityAt**
  - Method: `sweep()`
  - Setup: Session with lastActivityAt = Jan 1, 2026 00:00:00; mock Date.now() to return Jan 1, 2026 00:05:00 (5 min)
  - Assert: Log message contains "idleMs=300000"

## Gotchas

- **Timer setup/teardown:** Use `jest.useFakeTimers()` in beforeEach and `jest.useRealTimers()` in afterEach to avoid test pollution. The timer is stored in a private field, so use spies on global `setInterval` and `clearInterval` to verify calls.

- **Date.now() mocking:** The sweep() method calls `Date.now()` to calculate the threshold. Mock it with `jest.spyOn(Date, 'now')` or use fake timers that also mock Date.now() behavior.

- **Private sweepTimer field:** Cannot directly inspect the stored timer ID, but can spy on `clearInterval` to verify shutdown clears it. Alternatively, trigger a sweep() call manually during tests that don't use the timer.

- **Error suppression in bootstrap callback:** The setInterval callback wraps sweep() in `.catch()` to suppress errors. In unit tests, call sweep() directly to test error handling — the bootstrap callback logic (error logging) is integration-level.

- **Fire-and-forget abandonment:** abandonStale() is awaited, but closeAll() is not. Ensure tests await sweep() to catch any errors, but don't assume closeAll() errors are caught.

- **lastActivityAt is a Date object:** Use `new Date(timestamp)` when creating mock sessions to match the entity type.

- **Repository.find() with TypeORM query builder:** The where clause uses `In()` and `LessThan()` from TypeORM. Mock repo.find() to return a plain array; the test does not need to replicate TypeORM's where clause parsing.

- **configService.get<number>():** Ensure the mock returns `undefined` or a number, never a string, to match the type signature.

