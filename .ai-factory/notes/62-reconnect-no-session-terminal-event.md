# Reconnect: client-confirmed session abandonment

**Date:** 2026-06-23
**Source:** conversation context (supersedes the original "emit ABANDONED on null reconnect" design)

## Pre-work — clear the failed run's leftover code first
The earlier orchestrator attempt left its **rejected** implementation in the tree (now reverted, but re-check before starting): a `recentlyAbandoned = new Set<string>()` in the engine, `.add(userId)` in `abandonActivity`/`abandonStale`, a `handleReconnect(): … | 'abandoned' | null` string sentinel, and an else-branch `ABANDONED` emit in the controller. This design is **rejected** — start from clean `HEAD` (`handleReconnect(userId): Promise<ModuleSession | null>`, null branch emits nothing). Implement the variant below instead.

## Key Findings

- **The original "emit ABANDONED whenever handleReconnect returns null" design was wrong.** `handleReconnect` (`activity-engine.service.ts`, HEAD: `if (!activitySessionStore.has(userId)) return null`) returns `null` for **three** distinct cases — first/fresh connect, clean `activity:end`/`stop`, and genuine post-grace abandonment. The mobile opens the control stream **eagerly on connect** (`mind_mobile ModuleStateChannel.dart:54-57`), so a blanket `ABANDONED` on `null` fires on **every idle connect**, contradicting the documented `idle` protocol (`docs/realtime/session-lifecycle.md:20`).
- **The `recentlyAbandoned: Set<userId>` patch is rejected** — unbounded growth (offline-abandoned users who never return) + a watchdog TOCTOU that plants a stray flag → spurious `ABANDONED` on a later legitimate connect. Server-held limbo state about a user between two connects.
- **Decision: abandonment is client-confirmed.** The client presents the `moduleSessionId` it believes is live; the server answers **authoritatively** from the in-memory store (resumable) and the DB row status (terminal). No server memory of "who was abandoned." Better DX: the client gets a definitive answer about its own session instead of inferring from silence.

## Details

### Transport of the client's session id — gRPC metadata (pinned)
- Metadata key: literal **`module-session-id`** (gRPC lowercases metadata keys). Add it as a constant beside `GRPC_USER_KEY` in `src/grpc/grpc-auth.constants.ts` — do not inline the string.
- Read mechanism: mirror `GrpcCurrentUser` (`src/grpc/decorators/grpc-current-user.decorator.ts:8`) — `ctx.switchToRpc().getContext<Metadata>()` (`Metadata` from `@grpc/grpc-js`), then `metadata.get('module-session-id')[0]?.toString()` (returns `string | undefined`). Cleanest: a sibling param decorator (e.g. `@GrpcMetadataValue('module-session-id')`) on `trackActivity`, captured at the handler level and closed over inside `setup()` (`module-state.grpc.controller.ts:106`).
- Backward compatible: old clients omit it → `undefined` → server stays silent (today's behavior). No proto change → no `mind_mcp`/`mind_mobile` regeneration.

### Engine — `handleReconnect(userId, clientSessionId?)`
Change the signature from HEAD's `handleReconnect(userId: string): Promise<ModuleSession | null>` to:
`handleReconnect(userId: string, clientSessionId?: string): Promise<ModuleSession | { abandoned: true } | null>` — **object result `{ abandoned: true }`, NOT a `'abandoned'` string sentinel; NO `recentlyAbandoned`.**

Resolution order (synchronous, flag-free):
1. In-memory store has a resumable entry for `userId` → return the `ModuleSession` (→ controller emits `RESUMED`). Unchanged from HEAD.
2. Else if `clientSessionId` provided → `this.repo.findOne({ where: { id: clientSessionId, userId } })` (the engine already injects `Repository<ModuleSession>` at `activity-engine.service.ts:27-28`; `findOne` precedent at `:115`/`:189`; entity fields `id` `module-session.entity.ts:16`, `userId` `:21`, `status` `:30`):
   - `row?.status === SessionStatus.ABANDONED` (`src/realtime/enums/session-status.enum.ts:5`, value `'abandoned'`) → return `{ abandoned: true }`.
   - row `null`, or status `SessionStatus.COMPLETED` (`:4`, `'completed'`) / `SessionStatus.INTERRUPTED` (`:6`, `'interrupted'`) / any other → return `null` (silent).
3. Else (no `clientSessionId`) → `null` (silent = backward compat).

The DB row is the durable authoritative source — `abandonActivity` (grace) and `abandonStale` (watchdog) already write `status = SessionStatus.ABANDONED, endedAt = now`. No in-memory flag, no leak, no TOCTOU.

### ⚠️ Enum trap — two different `ABANDONED`
The DB column is **`SessionStatus`** (string enum, `session-status.enum.ts`): `ABANDONED = 'abandoned'`. The proto response field is **`ActivityStatus`** (int enum, `proto/generated/module_state.ts:33-40`): `ABANDONED = 4`. They are distinct types — compare the **DB row** against `SessionStatus.ABANDONED`, emit `ActivityStatus.ABANDONED` on the wire. Do not cross them.

### Controller — `trackActivity` setup (`module-state.grpc.controller.ts:106-123`)
- Capture the `module-session-id` metadata value (see above); pass to `handleReconnect(userId, clientSessionId)` (call site `:107`).
- Resumable `ModuleSession` → `RESUMED` (existing `:111-114`, unchanged). `{ abandoned: true }` → `subscriber.next({ sessionState: { status: ActivityStatus.ABANDONED, moduleSessionId: clientSessionId } })`. `null` → emit nothing.
- Keep the `if (subscriber.closed) return;` guard (`:108`). **Keep the stream open** — no `subscriber.complete()` (the `connectedAt = Date.now()` at `:123` and command subscription proceed). Terminal for the *session*, not the transport: the client can immediately `activity:start` a fresh session. `ActivityStatus` is already imported (`:18`).

### Guards
- **Backward compatible:** old client omits the id → server silent → exactly today's idle behavior. Ships independently of mobile.
- The confirmation always carries the specific `moduleSessionId`.
- **Never resurrect** the abandoned session; **never auto-create** a new one — a new session is born only on an explicit client `activity:start`.
- Do **not** touch grace/watchdog logic (they still produce abandonment by writing the DB row status).
- Do **not** blanket-emit on bare `null`. Do **not** reintroduce `recentlyAbandoned`.

### Tests
- **Engine `handleReconnect` (load-bearing — the prior run shipped it untested):** store hit → returns the session; no store + DB `SessionStatus.ABANDONED` → `{ abandoned: true }`; no store + DB `COMPLETED`/missing row → `null`; no `clientSessionId` → `null`.
- **Controller:** `RESUMED` unchanged; abandoned → exactly one `sessionState{ status: ActivityStatus.ABANDONED, moduleSessionId }`; idle/no-id → no emit; stream stays open after the abandoned emit (a subsequent `activityStart` routes → `ACTIVE` at `values[1]`, proving no `complete()`).

### Verify
1. Open stream → disconnect → let grace abandon → reconnect presenting the old `moduleSessionId` → client receives exactly one `sessionState{ ABANDONED, moduleSessionId }`.
2. Fresh connect with no id (or a never-abandoned session) → no event (idle), per `session-lifecycle.md:20`.
3. Reconnect within grace → `RESUMED` as today.
