# Plan: Docs: correct the one-connection-per-service policy wording

## Context
Correct `docs/realtime/overview.md` so the `ActiveStreamRegistry` in-memory bullet and the "Политика одного соединения на каждый сервис" section describe the now-shipped per-service last-connect-wins eviction — including the `CONNECTION_SUPERSEDED` warning frame and the children-end/root-persists takeover nuance — instead of the pre-feature aspirational wording. Russian, correction not rewrite, behavior-not-code.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Grounding (read before editing)
The described mechanism must match the **shipped** code, not the note's design sketch. Confirm each claim against:
- `src/realtime/services/active-stream-registry.service.ts` — structure is `Map<userId, Map<StreamService, Subscriber>>` (one slot per service); `register` evicts the prior subscriber via `existing.complete()` after firing the optional `onEvict` hook; `deregister` returns `wasEvicted`; `closeAll(userId)` still completes every service subscriber for the user (used on auth-session revoke).
- `src/realtime/module-state.grpc.controller.ts:150-156` — STATE stream's `onEvict` pushes `sessionError { code: 'CONNECTION_SUPERSEDED' }` before the graceful close; `:257-283` — teardown branches on `wasEvicted`: eviction → `activityEngine.supersedeChildren(userId)`, genuine drop → `activityEngine.handleTransportDisconnect(userId)` unchanged.
- `src/realtime/services/activity-engine.service.ts:694-715` — `supersedeChildren` ends every child (status `INTERRUPTED`, `endedAt` set) and leaves the root untouched/ACTIVE.

Constraints from the spec:
- Do not name the `INTERRUPTED` status in the doc unless `overview.md` already names session statuses of that kind — verify before introducing any implementation-level term. Describe behavior ("дочерние сессии завершаются"), not the status constant.
- Do not describe `WeakSet`/internal bookkeeping or synchronous-ordering/race arguments — behavior-level only, matching the rest of the file.
- Do not conflate "takeover" with "abandon": the correction's whole point is that they are distinguishable — a takeover ends children immediately; a genuine drop goes through the existing disconnect + grace path unchanged.
- Touch **only** the "In-memory состояние" `ActiveStreamRegistry` bullet and the "Политика одного соединения на каждый сервис" section. Leave every other section untouched.

## Tasks

### Phase 1: Correct the docs

- [x] **Task 1: Correct the `ActiveStreamRegistry` in-memory bullet**
  Files: `docs/realtime/overview.md` (line 34)
  Rewrite the `ActiveStreamRegistry` bullet so its structure is described as a map keyed by `(userId, service)` — one active подписчик per realtime-сервис per пользователь (state, instruction, biometric, sync), not a flat "множество активных подписчиков под одним ключом". Keep the `closeAll(userId)` sentence — it remains accurate (all-services forced close on auth-session revoke). Russian, behavior-level, current-state only (no "было/стало" phrasing).

- [x] **Task 2: Rewrite the "Политика одного соединения на каждый сервис" section**
  Files: `docs/realtime/overview.md` (lines 36-38)
  Rewrite the section body to state the shipped mechanism precisely, covering all four points:
  - **Last-connect-wins per `(userId, service)`:** a new connection for the same user+service gracefully completes (not errors) the previous one; different service types coexist in parallel.
  - **STATE warning frame:** the evicted STATE connection first receives a `CONNECTION_SUPERSEDED` warning *before* the graceful close, letting the client distinguish "меня перехватило другое соединение → уйти в пассив" from a real network drop (which surfaces as an error, without this warning) — the anti-ping-pong signal between two simultaneously-online clients.
  - **Takeover semantics (STATE only):** the shared **корень** (непрерывная ось биоданных) stays live and is inherited by the new connection unchanged, while the evicted connection's own **дочерние сессии** (running practices) are ended — the new connection never inherits a practice it didn't start. A genuine network drop is unaffected: it still disconnects root and children through the existing disconnect + grace path.
  - **Other three services (instruction/bio/sync):** eviction just stops the old stream — no warning frame, no session-lifecycle effect.
  Russian, correction not rewrite, behavior-not-code; do not introduce implementation-level term names (no `INTERRUPTED`, no `WeakSet`, no race/ordering discussion).

- [x] **Task 3: Verify scope and cross-references** (depends on Task 2)
  Files: `docs/realtime/overview.md`, `docs/realtime/*.md`
  Read the two corrected sections against the shipped code (files listed in Grounding) — every claim must be checkable against a specific line. Confirm no other section of `overview.md` was modified. Grep `docs/realtime/` for "одного соединения" to confirm no other doc cross-references this policy section (and thus needs no companion edit).
