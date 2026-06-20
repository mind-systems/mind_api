# Plan: Reap only sessions with no live subscriber (M1) — switch predicate from data-idle to client-liveness

## Context
`SessionWatchdogService.sweep` currently reaps any stale-`lastActivityAt` session, which measures data-liveness rather than whether the client is connected. This milestone makes the watchdog skip any session whose `userId` still has a live subscriber in `ActiveStreamRegistry`, so only no-live-subscriber rows (DB-orphans, missed grace) are reaped.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Liveness predicate

- [ ] **Task 1: Add a per-user subscriber lookup to `ActiveStreamRegistry`**
  Files: `src/realtime/services/active-stream-registry.service.ts`
  The registry is `Map<userId, Set<Subscriber>>` and currently exposes no way to ask "does this userId have any live subscriber." Add a small public method `hasLiveSubscriber(userId: string): boolean` that returns `true` when `this.streams.get(userId)` exists and its `Set` is non-empty (the `deregister` method already deletes the key when its set empties, so an existence check is sufficient, but guard against an empty set anyway: `return (this.streams.get(userId)?.size ?? 0) > 0`). Do not record or branch on stream type — any open stream (control / instruction / biometric) counts as "client on the line." Keep the method side-effect free.

- [ ] **Task 2: Inject the registry into the watchdog and skip live-subscriber rows in the sweep loop** (depends on Task 1)
  Files: `src/realtime/services/session-watchdog.service.ts`
  Add `ActiveStreamRegistry` to the constructor (same module, already a provider — no export/import wiring needed beyond the `import` statement for the class). Leave the DB query in `sweep()` unchanged — it still selects `status IN (ACTIVE, DISCONNECTED)` with `lastActivityAt < threshold`. Inside the `for (const row of staleSessions)` loop, before reaping, check `this.activeStreamRegistry.hasLiveSubscriber(row.userId)`; if `true`, `continue` (skip — the client is connected and must not be reaped). Optionally emit a single debug/verbose log noting the skip with `sessionId`/`userId` (keep logging minimal). Only rows with no live subscriber reach `abandonStale`. Update the final summary log to reflect that skipped rows were not reaped (e.g. keep counting `reaped`; the count now naturally excludes skipped rows). Do not change the threshold or its semantics — its only remaining invariant (`WS_SESSION_MAX_IDLE_MS` 600s > `WS_RECONNECT_GRACE_MS` 30s) already holds.

## Notes
- Scope is strictly M1 (liveness predicate). M2 (`closeAll(userId)` cleanup on the residual reap path) and P4 (keepalive env parse) from the spec are explicitly out of scope for this milestone.
- Spec reference: `.ai-factory/notes/54-watchdog-liveness-proxy-risks.md`.
