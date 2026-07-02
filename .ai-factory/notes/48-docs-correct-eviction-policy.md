# Docs: correct the one-connection-per-service policy wording

**Date:** 2026-07-02
**Source:** conversation context (product decision — single-session engine)

Docs task. Depends on [[47-per-service-stream-eviction]] landing (the section becomes **true** only then — land this after, not before). Russian, correction only — not a rewrite. `mind_api/docs/` is Russian-language, owned by the API side (mirrors the convention set by [[14-realtime-docs-update]]).

## Problem
`docs/realtime/overview.md:34-37`:
```markdown
## In-memory состояние

- `ActivityQueryRegistry`/`ActiveStreamRegistry` — Map от `userId` к множеству активных gRPC-подписчиков пользователя. Один юзер держит несколько параллельных стримов (state, instructions, biometric, sync), все они живут как независимые подписчики под одним ключом. `closeAll(userId)` — единая точка принудительного закрытия всех каналов: используется при отзыве auth-сессии.

## Политика одного соединения на каждый сервис

Сервер допускает по одному активному соединению на пользователя в каждом из realtime-сервисов. Если приходит новый стрим того же типа, а старый ещё жив — старый принудительно закрывается. Стримы разных типов сосуществуют параллельно. Это защищает от гонок состояния при переключении сетей, перезапуске приложения или подключении с двух устройств.
```
This section **describes** per-service eviction as if implemented. Before [[47-per-service-stream-eviction]], it was aspirational (the registry only added to a `Set<userId>`, never evicted — verified `active-stream-registry.service.ts:16-23` at the time this doc section was written). After [[47-per-service-stream-eviction]] lands, the description becomes **true**, but several details are still imprecise or entirely absent against the actual mechanism (amended twice after the original brief — both amendments must be folded in here):
1. The registry's internal structure is described as "Map от `userId` к множеству" (Map from userId to a set) — after the fix it is `Map<userId, Map<StreamService, Subscriber>>` (nested, keyed by service, single slot per service — not a flat set).
2. The eviction paragraph doesn't say **how** the old stream is closed, and is missing the two load-bearing nuances settled after the original brief: (a) **`CONNECTION_SUPERSEDED`** — the STATE stream's evicted connection receives an explicit warning frame *before* the graceful close, letting the client distinguish "another connection took over" from a network drop (the anti-ping-pong fix); (b) **children end, the root persists** — a takeover is not "sessions stay live, reassigned" (the original brief's framing) but **"the shared root stays live; the evicted connection's own children are ended, so the new connection starts with a clean slate."** This is the single most product-relevant nuance and is currently entirely absent from the doc.

## Change (correction, not rewrite — ground every sentence against the post-[[47-per-service-stream-eviction]] source)
Edit `docs/realtime/overview.md`, the "In-memory состояние" bullet and the "Политика одного соединения на каждый сервис" section:
1. Update the `ActiveStreamRegistry` bullet: describe the structure as keyed by `(userId, service)` — one active subscriber per service per user, not a flat multi-subscriber set. Keep the `closeAll(userId)` sentence (still accurate — closeAll remains all-services, unchanged by [[47-per-service-stream-eviction]]).
2. Rewrite "Политика одного соединения на каждый сервис" to state the mechanism precisely, covering all three parts:
   - A new connection for the same `(userId, service)` **evicts** (gracefully completes, `complete()` — not an error) the previous one; this is **last-connect-wins**.
   - **For the STATE service:** the evicted connection first receives a warning (`CONNECTION_SUPERSEDED`) *before* the graceful close — this is what lets the client tell "I was taken over, go passive" apart from a real network drop (which surfaces as an error, with no such warning), avoiding a reconnect ping-pong between two simultaneously-online clients.
   - **Takeover semantics (STATE only):** the shared **root** (the continuous bio timeline) stays live and is inherited by the new connection unchanged; the evicted connection's own **child sessions** (the practices it had running) are ended — the new connection never inherits a practice it didn't start itself. A genuine network drop is unaffected by any of this: it still disconnects the root and every child, arming the grace/reconnect window exactly as before.
   - **For the other three services (instruction/bio/sync):** eviction simply stops the old stream, no warning frame, no session-lifecycle effect — they carry none.
3. Ground every sentence against the actual post-fix code: `active-stream-registry.service.ts` (structure, eviction, the `onEvict` hook), `module-state.grpc.controller.ts` (the `CONNECTION_SUPERSEDED` emission and the eviction-vs-drop branch), `activity-engine.service.ts` (`supersedeChildren`, and how it differs from a genuine disconnect). Do not describe the `WeakSet`/internal bookkeeping or the synchronous-ordering argument (`§Safety`/`§Safety-2` in [[47-per-service-stream-eviction]]) — this doc is behavior-level (per the project's documentation style — describe behavior, not code), matching the rest of `overview.md`. Do not name the `INTERRUPTED` status explicitly unless the surrounding doc already names statuses elsewhere in this file — check before adding a new implementation-level term.

## Guards
- Russian language, matching every neighboring section.
- Behavior-not-code, current-state-only (no "was changed to" — this repo's documentation-style convention, established by [[14-realtime-docs-update]]).
- Do not touch any other section of `overview.md` (the transport/session split, the two-level session model) — scope is exactly the "In-memory состояние" bullet + the "Политика одного соединения" section.
- Land this task **after** [[47-per-service-stream-eviction]] is implemented — verify the described mechanism against the landed code, not this note's design sketch (the implementation may have deviated in a detail during review).
- Do not conflate "takeover" with "abandon" in the wording — the whole point of this correction is that the two are now distinguishable (children end explicitly and immediately; a genuine drop instead goes through the existing disconnect+grace path unchanged).

## Verify
- Read the corrected section aloud against the shipped `active-stream-registry.service.ts` + `module-state.grpc.controller.ts` + `activity-engine.service.ts` (`supersedeChildren`) — every claim must be checkable against a specific line.
- Confirm the doc states all three reader-relevant facts: (1) eviction is per-`(userId, service)`, last-connect-wins; (2) the STATE stream's evicted connection is warned (`CONNECTION_SUPERSEDED`) before closing; (3) a takeover ends the evicted connection's children but keeps the shared root live — distinct from a genuine drop, which still disconnects everything.
- No other `docs/realtime/*.md` file references this policy section (confirm with a grep for "одного соединения" across `docs/realtime/` before finalizing, in case another doc cross-references it).
