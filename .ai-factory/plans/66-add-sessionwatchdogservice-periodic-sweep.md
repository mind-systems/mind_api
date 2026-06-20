# Plan: Add `SessionWatchdogService` periodic sweep

## Context
Add a defense-in-depth scheduled reaper that finalizes realtime sessions whose `lastActivityAt` has gone stale (silent-but-alive streams, misconfigured keepalive, rows missed by startup recovery), independent of transport-disconnect detection. This is a backstop derived from a production incident where a leaked `ACTIVE` row survived 3 days because the process never restarted. Spec: `.ai-factory/notes/52-idle-session-watchdog.md`; ROADMAP milestone "Add `SessionWatchdogService` periodic sweep".

## Settings
- Testing: no
- Logging: minimal (warn on every reap + one summary — never silent)
- Docs: no

## Tasks

### Phase 1: Configuration

- [x] **Task 1: Add max-idle and sweep-interval config keys**
  Files: `src/realtime/constants/realtime-config.ts`
  Append two keys to the `RealtimeConfig` object:
  `SESSION_MAX_IDLE_MS: 'WS_SESSION_MAX_IDLE_MS'` and `SESSION_SWEEP_INTERVAL_MS: 'WS_SESSION_SWEEP_INTERVAL_MS'`.
  Follow the existing key style in the file (string env-var name, `as const` preserved).

### Phase 2: Safety fix to `abandonStale`

- [x] **Task 2: Guard the in-memory store delete in `abandonStale` by session identity** (correctness fix — must land before/with the watchdog)
  Files: `src/realtime/services/activity-engine.service.ts`
  Problem: `abandonStale` (`activity-engine.service.ts:196-239`) ends with an **unconditional** `this.activitySessionStore.delete(userId)` (line 226). The store is keyed by `userId`, not `sessionId`. The watchdog sweeps DB rows by `userId`, so a reachable sequence silently kills a healthy session:
  1. A stale orphan `ACTIVE` row `S1` exists for user `U` with no matching in-memory entry (the "row missed by startup recovery" case this watchdog targets).
  2. `U` starts a fresh session `S2`. `handleActivityStart` only guards on the in-memory `getActiveSession(userId)` (`module-state.grpc.controller.ts:261`), which is empty, so `S2` is created and the store entry now points at `S2`.
  3. The watchdog reaps `S1` → `abandonStale(U, S1)` finalizes `S1`, then `activitySessionStore.delete(U)` deletes the entry for the **live** `S2`, silently terminating it.
  Fix: only clear the in-memory entry when it actually points at the reaped session. Replace the final unconditional `this.activitySessionStore.delete(userId)` (the one after the successful abandon, line 226) with:
  ```ts
  const state = this.activitySessionStore.get(userId);
  if (state?.sessionId === sessionId) {
    this.activitySessionStore.delete(userId);
  }
  ```
  Apply the same sessionId-guarded delete to the two early-return branches in `abandonStale` as well (the `!session` branch at line 198-201 and the already-finalized branch at line 208-211), so none of them can evict a different live session's entry.
  This is safe for the existing grace-timer caller too: there the stored `sessionId` always matches, so behavior is unchanged. Do **not** touch `abandonActivity` — it reads `state.sessionId` first and is keyed correctly already.

### Phase 3: Watchdog service

- [x] **Task 3: Create `SessionWatchdogService`** (depends on Tasks 1, 2)
  Files: `src/realtime/services/session-watchdog.service.ts`
  Create an `@Injectable()` service that runs a periodic sweep of stale sessions.
  - Constructor-inject `@InjectRepository(ModuleSession) repo: Repository<ModuleSession>`, `ActivityEngine`, and `ConfigService`.
  - Read `maxIdleMs = configService.get<number>(RealtimeConfig.SESSION_MAX_IDLE_MS, 600_000)` and `sweepIntervalMs = configService.get<number>(RealtimeConfig.SESSION_SWEEP_INTERVAL_MS, 60_000)` in the constructor (mirror the `StreamEngine` constructor pattern at `src/realtime/services/stream-engine.service.ts:46-61`). The sweep interval must stay ≪ the idle threshold so reaping latency stays bounded; the defaults (60s vs 600s) satisfy this.
  - Scheduling: because the `@Interval` decorator cannot read a `ConfigService` value (it is evaluated at class-load time, before DI), drive the sweep with `setInterval` started in `onApplicationBootstrap()` and cleared in `onApplicationShutdown()`, implementing `OnApplicationBootstrap` + `OnApplicationShutdown` exactly like `StreamEngine` (`stream-engine.service.ts:68-81`). Type the handle as `ReturnType<typeof setInterval> | undefined` (field at `stream-engine.service.ts:37`) and guard `clearInterval` with an `undefined` check in shutdown (`stream-engine.service.ts:76-81`) — do not use `NodeJS.Timeout` or skip the guard. The interval callback calls `this.sweep().catch(...)` and logs errors via the class `Logger`. (If a fixed 60s cadence is acceptable, a literal `@Interval(60_000)` matching `observability.service.ts:15` is a valid fallback — `ScheduleModule.forRoot()` is registered — but the config-driven `setInterval` is the intended approach since `WS_SESSION_SWEEP_INTERVAL_MS` must be honored.)
  - `async sweep(): Promise<void>`:
    - Compute `threshold = new Date(Date.now() - this.maxIdleMs)`.
    - Query stale rows: `this.repo.find({ where: { status: In([SessionStatus.ACTIVE, SessionStatus.DISCONNECTED]), lastActivityAt: LessThan(threshold) } })` (import `In`, `LessThan` from `typeorm`).
    - If empty, return without logging.
    - For each row, isolate failures so one bad row never blocks the rest of the batch: in a `try/catch`, log a `this.logger.warn(...)` including `sessionId`, `userId`, idle duration in ms (`Date.now() - row.lastActivityAt.getTime()`), then `await this.activityEngine.abandonStale(row.userId, row.id)`, counting it as reaped on success; on throw, `this.logger.error(...)` with the `sessionId` and continue to the next row. Reaping must never be silent.
    - After the loop, emit a single summary `this.logger.warn` with the count of successfully reaped sessions (e.g. `Watchdog swept N stale sessions`).
    - Read-only on `lastActivityAt` — never write/reset it anywhere in the sweep.
    - No pause special-casing: do not query or branch on `isPaused`. Biometrics stream through pause (Phase 49), so a paused-but-connected session keeps advancing `lastActivityAt` and is never idle.
  - Use `new Logger(SessionWatchdogService.name)` per the project logging rule (`@nestjs/common` `Logger`, never `console`).
  - `abandonStale` already exists on `ActivityEngine` (`activity-engine.service.ts:196`, hardened in Task 2); reuse it — it routes through `SessionEvents.ABANDONED` so both stream engines flush and drop buffers, and it no-ops on already-finalized rows.

### Phase 4: Registration

- [x] **Task 4: Register `SessionWatchdogService` in `RealtimeModule`** (depends on Task 3)
  Files: `src/realtime/realtime.module.ts`
  Import `SessionWatchdogService` and add it to the `providers` array. The `ModuleSession` repo is already on `TypeOrmModule.forFeature` (line 25-29) and `ActivityEngine` is already a provider — no other wiring needed. Do not export it.
