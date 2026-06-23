# Plan: Reconnect resolves session by client-presented id → confirms abandonment

## Context
On reconnect, the server must authoritatively tell a client whether its last-known session is resumable, terminally abandoned, or unknown — instead of silently leaving a grace-abandoned client streaming into a dead session (`NO_SESSION` flood). The client presents its `moduleSessionId` via gRPC metadata; the engine resolves it against the in-memory store (→ `RESUMED`) or the DB row status (→ one terminal `ABANDONED` event), and stays silent otherwise (backward-compatible idle behavior).

## Settings
- Testing: yes (engine + controller — explicitly required by the milestone)
- Logging: minimal (NestJS `Logger`, per existing controller/engine convention)
- Docs: no

## Pre-work / Verification
The earlier orchestrator attempt's rejected design (`recentlyAbandoned` Set, `.add(userId)` in `abandonActivity`/`abandonStale`, a `'abandoned'` string sentinel, an else-branch blanket `ABANDONED` emit) has been reverted. Confirmed clean at HEAD:
- `activity-engine.service.ts:431-435` — `handleReconnect(userId: string): Promise<ModuleSession | null>`, silent null branch, no `recentlyAbandoned`.
- `module-state.grpc.controller.ts:106-121` — `setup()` calls `handleReconnect(userId)` and emits only on a live session.

If any of the rejected artifacts reappear before starting, remove them first. Implement the client-confirmed variant below.

Scope confirmation (review Note 4): engine path 2 emits `{ abandoned: true }` **only** when the DB row is already `SessionStatus.ABANDONED`. A row left in `DISCONNECTED`/`ACTIVE` with no in-memory entry (e.g. a server-restart-orphaned grace session before the stale watchdog runs) resolves to `null` (silent) — reconciliation of those rows is the watchdog's job, per `docs/realtime/session-lifecycle.md`. This is the intended "stays silent otherwise" behavior; do not widen path 2 to other statuses.

## Tasks

### Phase 1: Transport — carry the client session id

- [x] **Task 1: Add the `module-session-id` metadata key constant**
  Files: `src/grpc/grpc-auth.constants.ts`
  Add `export const GRPC_MODULE_SESSION_ID_KEY = 'module-session-id';` beside the existing `GRPC_USER_KEY` / `GRPC_TOKEN_KEY`. gRPC lowercases metadata keys, so the literal must be lowercase. Do not inline the string anywhere — reference this constant.
  Note: this is a **plain string wire key** read via `metadata.get(key)` (Task 2), unlike the neighboring `GRPC_USER_KEY` / `GRPC_TOKEN_KEY`, which are `Symbol`s stashed on the metadata object by the interceptor and read as `(metadata as any)[SYMBOL]`. Co-locate it for discoverability, but do **not** mirror the Symbol-property pattern.

- [x] **Task 2: Add a `@GrpcMetadataValue` param decorator** (depends on Task 1)
  Files: `src/grpc/decorators/grpc-metadata-value.decorator.ts` (new)
  Mirror `GrpcCurrentUser` (`src/grpc/decorators/grpc-current-user.decorator.ts`): a `createParamDecorator((key: string, ctx) => ...)` that reads `ctx.switchToRpc().getContext<Metadata>()` (`Metadata` from `@grpc/grpc-js`) and returns `metadata.get(key)[0]?.toString()` — type `string | undefined`. The decorator takes the metadata key as its `data` argument so it can be used as `@GrpcMetadataValue(GRPC_MODULE_SESSION_ID_KEY)`. This matches the interceptor's own wire-key read (`metadata.get('authorization')[0]?.toString()`).

### Phase 2: Engine + Controller — resolve and emit (ship together)

> Tasks 3–5 form one atomic change: Task 3 widens `handleReconnect`'s return type, which makes the current controller branch (`session.id`) stop typechecking until Task 5 updates it. They must land in the same commit so no intermediate tree is broken (review Issue 1).

- [x] **Task 3: Extend `handleReconnect` to resolve a client-presented session id**
  Files: `src/realtime/services/activity-engine.service.ts`
  Change the signature from `handleReconnect(userId: string): Promise<ModuleSession | null>` to `handleReconnect(userId: string, clientSessionId?: string): Promise<ModuleSession | { abandoned: true } | null>`. Resolution order (flag-free, no `recentlyAbandoned`):
  1. `this.activitySessionStore.has(userId)` → keep existing path: `cancelGraceTimer(userId)` then `return this.resumeActivity(userId)` (resumable `ModuleSession`).
  2. Else if `clientSessionId` is provided → `this.repo.findOne({ where: { id: clientSessionId, userId } })` (repo already injected at `:27-28`; `findOne` precedent at `:115`). The `userId` scoping is required — it prevents a client from resolving another user's session id. If `row?.status === SessionStatus.ABANDONED` → `return { abandoned: true }`. For `null` row, `COMPLETED`, `INTERRUPTED`, `DISCONNECTED`, or any other status → `return null`.
  3. Else (no `clientSessionId`) → `return null`.
  Enum trap: compare the **DB row** against `SessionStatus.ABANDONED` (string enum, `enums/session-status.enum.ts`) — do **not** use the proto `ActivityStatus` here. Add a minimal `this.logger.log` only on the abandoned-confirmation branch. Never resurrect or auto-create a session; do not touch grace/watchdog (`abandonActivity`/`abandonStale`) — they remain the writers of the DB `ABANDONED` row.

- [x] **Task 4: Capture the metadata value and pass it to `handleReconnect`** (depends on Task 2, Task 3)
  Files: `src/realtime/module-state.grpc.controller.ts`
  Add a `@GrpcMetadataValue(GRPC_MODULE_SESSION_ID_KEY) clientSessionId: string | undefined` parameter to `trackActivity` (alongside `@Payload()` and `@GrpcCurrentUser()`), and close over it inside `setup()`. **Keep `@Payload()` on the request parameter** (RULES.md: gRPC methods using `@GrpcCurrentUser()` must keep `@Payload()` in explicit-injection mode — adding a third decorator does not change this). Update the call at `:107` to `handleReconnect(userId, clientSessionId)`. Import the decorator and the constant.

- [x] **Task 5: Branch on the `handleReconnect` result in `setup()`** (depends on Task 4)
  Files: `src/realtime/module-state.grpc.controller.ts`
  Keep the `if (subscriber.closed) return;` guard (`:108`). Replace the single `if (session)` block with a branch on the result shape:
  - Resumable `ModuleSession` (no `'abandoned'` key) → existing `RESUMED` emit, unchanged (`moduleSessionId: session.id`).
  - `{ abandoned: true }` → emit exactly one `sessionState` with proto `ActivityStatus.ABANDONED` (already imported at `:18`). **Narrow `moduleSessionId` first:** TypeScript cannot prove across the closure that `clientSessionId` (typed `string | undefined`) is defined here, even though this branch is only reachable when it was provided. Assign it to a local that is provably a `string` before constructing the event (e.g. guard `if (!clientSessionId) return;` immediately before the emit, then use `clientSessionId`) so an empty/undefined id never reaches the client. Do **not** paper over it with `?? ''`.
  - `null` → emit nothing.
  Distinguish the two non-null shapes with a type guard (e.g. `'abandoned' in result`). **Keep the stream open** — no `subscriber.complete()`; `connectedAt = Date.now()` and the command subscription (`:123-145`) must proceed so the client can immediately `activity:start`.

### Phase 3: Tests

- [x] **Task 6: Engine `handleReconnect` unit tests** (depends on Task 3)
  Files: `src/realtime/services/activity-engine.service.spec.ts`
  Add cases: (a) store hit → returns the resumed `ModuleSession` (mock store `has`→true, `resumeActivity`); (b) no store + `clientSessionId` whose DB row status is `SessionStatus.ABANDONED` → resolves `{ abandoned: true }`; (c) no store + DB row `COMPLETED` → `null`; (d) no store + missing row (`findOne`→null) → `null`; (e) no `clientSessionId` → `null` (assert `findOne` is **not** called). For (b)–(d) assert `repo.findOne` is queried with `where` containing **both** `id: clientSessionId` and `userId` (the `userId` scoping must not regress silently).

- [x] **Task 7: Controller `trackActivity` reconnect tests** (depends on Task 5)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  The spec already drives `controller.trackActivity(request$, user)` positionally and mocks `activityEngine.handleReconnect` — pass the `clientSessionId` as the third positional arg. Add cases: (a) `RESUMED` path unchanged; (b) abandoned → exactly one `sessionState{ status: ActivityStatus.ABANDONED, moduleSessionId: <clientSessionId> }`; (c) idle / no id → no emit; (d) stream stays open after an abandoned emit — a subsequent `activityStart` routes to `ACTIVE` at the next emitted value, proving `complete()` was not called.

## Commit Plan
- **Commit 1** (tasks 1–2): "Add client session id gRPC metadata key and accessor decorator"
- **Commit 2** (tasks 3–5): "Resolve and confirm session abandonment on reconnect" — engine signature widening and the controller branch ship together so the tree compiles at every commit.
- **Commit 3** (tasks 6–7): "Cover reconnect session resolution with engine and controller tests"
