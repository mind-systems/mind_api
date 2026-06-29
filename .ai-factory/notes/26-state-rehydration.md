# Rehydrate the realtime session store on restart

**Date:** 2026-06-29
**Source:** conversation context

## Key Findings

- `StartupRecoveryService` currently **abandons** every in-flight session on boot, so any server restart (graceful or crash) severs ongoing work: a returning client cannot resume because the in-memory store is empty (`handleReconnect` finds nothing), and `ensureRoot` mints a fresh root — splitting one practice into `[abandoned old]` + `[new]`.
- All durable state lives in `module_sessions`, and pause in the crash-durable `PAUSED`/`RESUMED` timeline marker ([[25-persist-ispaused]]) — `isPaused` is **derived** from it on boot, not read from a column (there is none). Recovery should **rebuild** the in-memory store from those rows rather than discard them, then let the **existing** reconnect/grace machinery resume returning clients and abandon the rest.
- No new table, no sample-level dedup, no shutdown-time status writes are needed.

## Details

### Current state
- `StartupRecoveryService.onApplicationBootstrap` (`src/realtime/services/startup-recovery.service.ts`) loads sessions with `status ∈ {ACTIVE, DISCONNECTED}` and bulk-saves them `ABANDONED, endedAt = now`. It does **not** repopulate the store, push markers, or emit `SessionEvents.ABANDONED` — inconsistent with the grace-abandon path (`abandonActivity`, which does all three).
- Its constructor injects **only** `repo` (`@InjectRepository(ModuleSession)`). Rehydrate needs the store and the engine, so the ctor must grow — see "Constructor" below (a loud DI change).
- `session_stream_samples` (`session-stream-sample.entity.ts`): `@Index(['moduleSessionId'])`, `samples jsonb` (array of event objects, each `{ event, timestamp, ... }`), `flushedAt`. This is the source the pause derive reads.
- `ActivitySessionStore` shape: `Map<userId, { rootSessionId, children: Map<sessionId, ActivityState> }>`. API: `setRoot(userId, rootId, state)`, `addChild(userId, sessionId, state)`, `getRootId`, `startGraceTimerForSession(sessionId, onExpiry)`, `cancelGraceTimerForSession`. Grace duration `graceMs` = `WS_RECONNECT_GRACE_MS` or default `30_000`.
- `handleReconnect(userId, clientSessionId)` already reads the store, cancels each session's grace timer, calls `resumeActivity`, and returns `soleChild ?? root` — it needs **only** a populated store to work after a restart.
- `abandonActivity` (grace-expiry path) marks `ABANDONED`, pushes the abandon marker, emits `SessionEvents.ABANDONED` (→ bio flush + stats). `disconnectedAt` is the per-session disconnect time.

### Change
Replace the abandon logic in `onApplicationBootstrap` with **rehydrate**:
1. Load `module_sessions` with `status ∈ {ACTIVE, DISCONNECTED}` (roots + children).
2. Rebuild the store: for each root row `setRoot`; for each child row `addChild`, linking via `rootSessionId`. **Derive `isPaused`** for each child from its last pause-related marker (see "Pause derive" below).
3. Mark every rehydrated row `DISCONNECTED` with `disconnectedAt = lastActivityAt` (best estimate of when the connection was lost — the real crash time is unknown).
4. Arm a per-session grace timer **from process start** (so any client gets a full grace window regardless of how long the server was down), with `onExpiry = () => abandonActivity(userId, sid)`.
5. Returning clients resume through the existing `handleReconnect` path (cancels grace, resumes, emits the `RECONNECTED` marker from [[23-connection-loss-markers]]). Clients that never return are abandoned **consistently** by the same grace timer (`abandonActivity` — marker + events), replacing today's silent bulk abandon.

### Constructor (structural — pin arity)
`StartupRecoveryService` injects only `repo` (`Repository<ModuleSession>`) today. Rehydrate must add: `ActivitySessionStore` (repopulate + arm grace), `ActivityEngine` (`abandonActivity` on expiry), and `@InjectRepository(SessionStreamSample) streamSampleRepo` (`Repository<SessionStreamSample>`, to read the pause markers for the derive). New ctor: `StartupRecoveryService(repo, streamSampleRepo, activitySessionStore, activityEngine)`. This is a loud DI change — pin this arity; the test note [[29-test-state-rehydration]] constructs against it.

### Pause derive (replaces any column read)
For each rehydrated **child**, derive `isPaused` from its last pause-related marker: `streamSampleRepo.find({ where: { moduleSessionId: sid } })`, scan the rows' `samples` arrays for the latest element whose `event` is `'paused'` or `'resumed'` by `timestamp`. Last is `'paused'` → `isPaused = true`; last is `'resumed'` or no pause marker → `isPaused = false`. These markers are durable because [[25-persist-ispaused]] persists every `SESSION_EVENT` immediately at emit — **no `module_sessions` column**. (Roots are never paused — derive applies to children only.)
- Grace clock for rehydrated sessions = process-start + `graceMs`, **not** `lastActivityAt + graceMs`.
- No new table; `module_sessions` is the durable store.
- No sample-level dedup — rare crash-boundary bio duplicates (client replay of un-acked samples) are accepted for now.
- Graceful shutdown is untouched: it already flushes buffers via `BiometricStreamEngine.onApplicationShutdown → flushAll` (and the `StreamEngine` equivalent). Do **not** add session-status writes on shutdown — boot-time rehydrate normalizes both crash and graceful to the same state.

### Guards / gotchas
- Depends on [[25-persist-ispaused]] (the durable marker the pause derive reads); composes with [[23-connection-loss-markers]] (`RECONNECTED` marker on resume) and [[24-pause-state-integrity]] (resume preserves `isPaused`).
- The empty-root janitor still reaps childless roots — a rehydrated childless root that no client reclaims is grace-abandoned, then swept normally.
- **Anti-target:** `startup-recovery.service.spec.ts:29-53` (`'abandons orphan sessions on bootstrap'`) asserts the OLD bulk-abandon `repo.save` with `status: ABANDONED` — DELETE or INVERT when this lands; `:55-61` (empty → no-op) survives as characterization.
- The DB restart round-trip is verified **manually** (no DB/integration test); the rebuild/grace/derive logic is unit-testable per [[29-test-state-rehydration]].

### Verify
- Start a practice → restart the server → reconnect within grace: the same root + child ids resume (status `ACTIVE`), the session is **not** abandoned, and no duplicate root is created.
- A paused session comes back **paused** after restart (with [[24-pause-state-integrity]] + [[25-persist-ispaused]]).
- A session whose client never returns within grace is abandoned with its marker + `SessionEvents.ABANDONED` emitted (bio flushed, stats consistent).

## Open Questions
- None.
