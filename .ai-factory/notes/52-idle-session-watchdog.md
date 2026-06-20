# Idle-session watchdog — reap stale active sessions independent of transport

**Date:** 2026-06-20
**Source:** conversation context

## Key Findings

- The realtime session lifecycle has **no upper bound and no periodic reaper**. The reconnect grace window (`WS_RECONNECT_GRACE_MS`, default 30s, `src/realtime/services/activity-session-store.service.ts:5`) only bounds "disconnected → may return"; it does **not** cap total session length, and it never starts unless a transport disconnect is actually detected.
- The only thing that ever cleans up orphaned `ACTIVE`/`DISCONNECTED` rows is `StartupRecoveryService.onApplicationBootstrap` (`src/realtime/services/startup-recovery.service.ts`) — and only at process boot. The leaked session in this incident survived 3 days precisely because the process (PID 9492) never restarted. The only `@Interval` in the realtime module is the 60s metrics logger (`observability.service.ts:15`).
- `ActivityEngine.abandonActivity` (`src/realtime/services/activity-engine.service.ts:152-195`) **guards on `status === DISCONNECTED`** (line 165) and bails otherwise. The incident session stayed `ACTIVE` (its transport never signaled disconnect), so even if abandon were called it would no-op. A watchdog therefore needs an abandon path that finalizes a stale session regardless of whether it reached `DISCONNECTED`.
- The reliable staleness signal is the DB column `module_sessions.last_activity_at`: it is bumped on **every** flush that persists samples (`stream-engine.service.ts:164`, `biometric-stream-engine.service.ts:184`). In the incident it stopped advancing at ~15:48 when the bio stream went silent — a `lastActivityAt`-based sweep would have caught it. The in-memory `state.lastActivityAt` is **not** a reliable signal — it is only updated on pause/unpause/resume, not on data flow.
- This is the defense-in-depth layer that is independent of the keepalive fix (note 51): it also covers the case where a stream stays transport-alive but data silently stops, and the case where keepalive values are misconfigured. Closes both the "grace is not a ceiling" and "no periodic sweep" holes.

## Details

### Design

Add a scheduled sweep that finalizes any session whose `lastActivityAt` is older than a max-idle threshold, routed through the same `SessionEvents.ABANDONED` path so both engines flush and drop their buffers.

**Threshold:** new env `WS_SESSION_MAX_IDLE_MS` (default e.g. `600_000` = 10 min — comfortably longer than the 5s flush cadence and any normal pause, short enough to reap within minutes). Add to `RealtimeConfig` (`src/realtime/constants/realtime-config.ts`) as `SESSION_MAX_IDLE_MS: 'WS_SESSION_MAX_IDLE_MS'` and a sweep interval `WS_SESSION_SWEEP_INTERVAL_MS` (default 60_000).

**New `SessionWatchdogService`** (`src/realtime/services/session-watchdog.service.ts`), registered in `RealtimeModule` providers:
- `@Interval(sweepIntervalMs)` `sweep()`:
  - Query `ModuleSession` `WHERE status IN (ACTIVE, DISCONNECTED) AND lastActivityAt < now - maxIdleMs`.
  - For each row, finalize via a new `ActivityEngine` method (below). Log a warn with `sessionId`, `userId`, idle duration, and count — never silently reap.
- Inject `ActivityEngine` + the `ModuleSession` repo (repo already available through `TypeOrmModule.forFeature` in the module).

**New abandon path on `ActivityEngine`** — `abandonStale(userId: string, sessionId: string): Promise<void>`:
- Mirror `abandonActivity` but **without** the `status === DISCONNECTED` guard — abandon from `ACTIVE` or `DISCONNECTED`. Keep the "already finalized" guard: if the DB row is already `COMPLETED`/`INTERRUPTED`/`ABANDONED`, no-op + clear any lingering in-memory state.
- Set `status = ABANDONED`, `endedAt = now`, push the `SESSION_EVENT / ABANDONED` stream marker, `activitySessionStore.delete(userId)`, then `eventEmitter.emit(SessionEvents.ABANDONED, { sessionId, userId, … })`. The `@OnEvent(SessionEvents.ABANDONED)` handlers in `StreamEngine` (`stream-engine.service.ts:196`) and `BiometricStreamEngine` (`biometric-stream-engine.service.ts:216`) then flush + `buffers.delete`, stopping the perpetual `flush: nothing to flush` spam.
- For a DB-only row not present in the store (rare — e.g. a row missed by startup recovery), update the row to `ABANDONED` directly and still emit `SessionEvents.ABANDONED` so any lingering buffer keyed by `sessionId` is dropped.

### Why route through events, not a bare `repo.update`

A bare status update would leave the `StreamEngine`/`BiometricStreamEngine` buffers in their maps forever (they are only ever removed by the `COMPLETED`/`ABANDONED`/`INTERRUPTED`/`REVOKED` handlers). The whole point is to clear the buffers, so the watchdog **must** go through the `SessionEvents.ABANDONED` emit. This mirrors the existing finalization contract (Phase 18 added `REVOKED` for exactly this buffer-flush reason).

### Pause is NOT a problem (resolved 2026-06-20)

Earlier worry: a paused session goes idle and gets reaped mid-pause. **It does not.** Per product + Phase 49 (`accept samples through pause`):

- Meditation has **no pause** at all.
- Breath can pause, but while the device is active and the app is alive, **biometrics keep streaming during pause** (Phase 49 removed the pause guards, so the server records samples for any live session regardless of `isPaused`). Every persisting flush bumps `last_activity_at`, so a paused-but-connected session is never idle.

Therefore `last_activity_at` only stalls when data actually stops — i.e. the app died or the device disconnected — which is exactly what we want to reap. The watchdog needs **no pause special-casing**: do not query `isPaused`, do not skip paused sessions. The threshold just has to exceed the max gap between bio samples + the flush interval (seconds); 10 min is enormous headroom.

Note the transport-drop path is already covered with a tight bound: a lost connection → Phase 41 keepalive detects in ~40s → 30s grace → abandon (~70s). The watchdog's 10-min window is the slower backstop for cases the transport signal misses entirely (half-open with keepalive misconfigured, silent-but-alive stream, a row missed by startup recovery).

### Concurrency / correctness guards

- The grace timer and the watchdog could both target the same session. `abandonStale` and the existing `abandonActivity` both end with `activitySessionStore.delete` and re-fetch the row first; make `abandonStale` re-check the row status after fetch and no-op if already finalized, so a double-fire just lands on the "already finalized" branch.
- Do not reset `lastActivityAt` anywhere in the sweep — read-only on the timestamp.
- Keep the query cheap: `module_sessions` is indexed by id; add an index on `(status, last_activity_at)` only if the table is large (note as optional — likely unnecessary at current scale, mention but do not force a migration).

### Relationship to note 51

Independent and complementary. Note 51 (keepalive) reaps **dead transports** in ~70s. This watchdog reaps **idle sessions** regardless of transport state (silent-but-alive stream, misconfigured keepalive, missed startup recovery) on the `maxIdleMs` budget. Either alone would have resolved this specific 3-day incident; both together close distinct failure classes. Ship order does not matter — neither depends on the other.

### How to verify

- Start a session, push samples, then stop pushing (without ending/stopping) and hold the transport open. After `WS_SESSION_MAX_IDLE_MS` elapses, the next sweep should log the warn and abandon it; `activeSessions` drops to 0 and the buffer-flush spam stops.
- Unit test `abandonStale`: (a) `ACTIVE` stale row → `ABANDONED` + `SessionEvents.ABANDONED` emitted + store cleared; (b) already-`COMPLETED` row → no-op, no event; (c) DB-only row not in store → row updated + event emitted.

## Open Questions

- None blocking. The pause concern is resolved (biometrics flow during pause → never idle → no special-casing). 10-min threshold is a safe default; it only needs to exceed the bio-sample/flush cadence, which it does by orders of magnitude.
