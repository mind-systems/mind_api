# Plan: Rehydrate the session store instead of abandoning

## Context
Replace the boot-time bulk-abandon of in-flight realtime sessions with a rehydrate step that rebuilds the in-memory `ActivitySessionStore` from `module_sessions`, so a returning client resumes the same root+children through the existing reconnect/grace machinery instead of having its practice split into `[abandoned old] + [new]`.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Rehydration

- [x] **Task 1: Widen `StartupRecoveryService` constructor and load rows**
  Files: `src/realtime/services/startup-recovery.service.ts`
  Replace the single-`repo` constructor with the pinned 4-arg shape the spec constructs against (see `src/realtime/services/startup-recovery.service.spec.ts` lines 110-115):
  `constructor(@InjectRepository(ModuleSession) repo: Repository<ModuleSession>, @InjectRepository(SessionStreamSample) streamSampleRepo: Repository<SessionStreamSample>, activitySessionStore: ActivitySessionStore, activityEngine: ActivityEngine)`.
  Keep `onApplicationBootstrap` loading `module_sessions` with `status ∈ {ACTIVE, DISCONNECTED}` via `repo.find({ where: [{ status: ACTIVE }, { status: DISCONNECTED }] })`; keep the early `return` when the result is empty (the `no orphan sessions found` characterization test must stay green — no store calls, no `repo.save`, no `abandonActivity`).
  Partition the loaded rows into **roots** (`activityType === ActivityType.ROOT`, `rootSessionId === null`) and **children** (everything else), mirroring how `ActivityEngine` distinguishes root vs child. Do NOT keep the old bulk `repo.save(... ABANDONED ...)` logic — it is being inverted. Follow the `new Logger(StartupRecoveryService.name)` logging pattern already in the file; log a single lean summary line (e.g. rehydrated session count), never PII.

- [x] **Task 2: Add the `isPaused` pause-derive helper** (depends on Task 1)
  Files: `src/realtime/services/startup-recovery.service.ts`
  Add a private async helper that derives `isPaused` for a **child** session id from its durable pause markers in `session_stream_samples`: `streamSampleRepo.find({ where: { moduleSessionId: sid } })`, then flatten every row's `samples` array and scan for the latest element (by its `timestamp` field) whose event is `StreamSessionEvent.PAUSED` (`'paused'`) or `StreamSessionEvent.RESUMED` (`'resumed'`). Each sample element has shape `{ timestamp, data: { dataType, event } }` (as produced by `ActivityEngine.pushSessionEventMarker` and asserted by the spec's `makeSampleRow`) — read the event from `sample.data.event`. Rules: last matching marker is `paused` → `true`; last is `resumed`, or there is no pause/resume marker at all → `false`. Roots are never paused — do not call this helper for roots (use `isPaused: false`). Guard against missing/loosely-typed fields without the non-null assertion operator (`!`) per project RULES.

- [x] **Task 3: Rebuild the store, mark DISCONNECTED, and arm grace timers** (depends on Task 2)
  Files: `src/realtime/services/startup-recovery.service.ts`
  In `onApplicationBootstrap`, after partitioning:
  1. **Rebuild the store.** For each root row call `activitySessionStore.setRoot(userId, id, state)`; for each child row call `activitySessionStore.addChild(userId, id, state)`, linking children to their root via the row's `rootSessionId`. Build each `ActivityState` (`src/realtime/interfaces/activity-state.interface.ts`) from the row: `sessionId: id`, `activityType`, `activityRefId`, `rootSessionId`, `startedAt`, `lastActivityAt`, and `isPaused` (roots → `false`; children → derived via Task 2's helper).
  2. **Persist DISCONNECTED.** Mark every rehydrated row `status = SessionStatus.DISCONNECTED` with `disconnectedAt = lastActivityAt` (best estimate of connection-loss time — the real crash time is unknown) and persist. Do this for both currently-ACTIVE and currently-DISCONNECTED rows (normalizes both crash and graceful shutdown to the same state). Do NOT set `endedAt` and do NOT write `ABANDONED` here.
  3. **Arm grace from process start.** For every rehydrated session (roots and children) call `activitySessionStore.startGraceTimerForSession(sid, onExpiry)` where `onExpiry = () => this.activityEngine.abandonActivity(userId, sid)` (arming from process start gives any client a full grace window regardless of downtime). Mirror `ActivityEngine.handleTransportDisconnect`'s `.catch(...)` error handling on the abandon promise.
  Returning clients then resume via the existing `handleReconnect` path (cancels grace, emits the `RECONNECTED` marker); clients that never return are abandoned consistently by `abandonActivity` (marker + `SessionEvents.ABANDONED`). No new table, no shutdown-time status writes, no module wiring changes — `RealtimeModule` already provides `ActivityEngine`, `ActivitySessionStore`, and the `SessionStreamSample` repository.
