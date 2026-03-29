# SRP Violations in Realtime Layer

**Date:** 2026-03-28
**Source:** conversation context

## Key Findings

- Two classes violate SRP: `ModuleSessionGrpcController` (354 LOC) and `ActivityEngine` (361 LOC).
- All other realtime services are clean and focused (< 100 LOC each).
- The pattern is the same in both cases: one class absorbed the entire lifecycle instead of delegating.

## Details

### ModuleSessionGrpcController — 354 LOC

File: `src/realtime/module-session.grpc.controller.ts`

Does too many things in one place:
1. Stream setup / teardown
2. Auth metadata extraction
3. Command routing (start / end / pause / resume / stop)
4. Presence tracking
5. Rate limiting
6. Session recovery on reconnect
7. Grace timer cancellation on reconnect
8. Listening to auth session revocation events

Proposed split:
- Extract presence + stream lifecycle into a dedicated handler
- Keep command routing in the controller
- Rate limiting already lives in `RateLimiterService` — controller just calls it, that's fine

### ActivityEngine — 361 LOC

File: `src/realtime/services/activity-engine.service.ts`

Mixes four distinct concerns:
1. **DB persistence** — `repo.save()` on every state transition
2. **In-memory state** — delegates to `ActivitySessionStore` but also reads/writes it directly
3. **Stream push** — calls `streamEngine.push()` to send state events to client
4. **Event emission** — `eventEmitter.emit(SessionEvents.COMPLETED, ...)` etc.
5. **Grace timer orchestration** — start/cancel via `ActivitySessionStore`

Proposed split:
- `ActivityLifecycleService` — start / end / stop / abandon (DB + events)
- `ActivityStateService` — pause / unpause / reconnect / active session query (memory + stream push)

### What Is Clean

All other services are well-scoped:
- `StreamEngine` (199 LOC) — buffering + DB flush only
- `SyncStreamService` (83 LOC) — debounced event dispatch only
- `ModuleStreamGrpcController` (149 LOC) — sample validation + ingestion only
- `ActivitySessionStore`, `ActiveStreamRegistry`, `RateLimiterService`, `PresenceService` — all < 60 LOC, single responsibility

## Open Questions

- Is `ActivityEngine` painful enough to split now, or only when adding new activity types (yoga, meditation)?
- `ModuleSessionGrpcController` boilerplate (stream setup/teardown) is duplicated vs `ModuleStreamGrpcController` — worth extracting a base class or shared helper?
