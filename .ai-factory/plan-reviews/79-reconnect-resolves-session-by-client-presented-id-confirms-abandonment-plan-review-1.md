# Plan Review: Reconnect resolves session by client-presented id → confirms abandonment

**Plan:** `79-reconnect-resolves-session-by-client-presented-id-confirms-abandonment.md`
**Files Reviewed:** 7 (plan + engine, controller, decorator, constants, enum, proto, interceptor, both specs, RULES/ROADMAP/ARCHITECTURE)
**Risk Level:** 🟡 Medium — the design is sound and the codebase references are accurate, but the commit sequence produces a non-compiling intermediate tree, and one emit has a real TypeScript type error.

## Verification of plan assumptions (all confirmed accurate)

- `handleReconnect(userId): Promise<ModuleSession | null>` at `activity-engine.service.ts:431-435`, silent null branch, no `recentlyAbandoned` — confirmed clean at HEAD. ✅
- Controller `setup()` calls `handleReconnect(userId)` at `:107`, `if (subscriber.closed) return` at `:108`, single `if (session)` RESUMED emit at `:110-121`, command subscription at `:125-145`. ✅
- `repo` injected at `:27-28`; `findOne({ where: { id } })` precedent at `:115`. ✅
- `SessionStatus.ABANDONED` is a string enum (`'abandoned'`) in `enums/session-status.enum.ts`. ✅
- Proto `ActivityStatus.ABANDONED = 4` and `RESUMED = 6` exist; `SessionState` shape is `{ moduleSessionId: string; status: ActivityStatus; isPaused?: boolean }`. ✅
- `GrpcCurrentUser` is a `createParamDecorator` reading `ctx.switchToRpc().getContext<Metadata>()`. ✅
- The interceptor passes the **live** `@grpc/grpc-js` `Metadata` object to the controller and itself reads wire keys via `metadata.get('authorization')[0]?.toString()` — so the planned `metadata.get('module-session-id')[0]?.toString()` is the correct mechanism. ✅
- Store methods `has`, `cancelGraceTimer`, `startGraceTimer` all exist. ✅
- Both spec files exist; the controller spec already drives `controller.trackActivity(request$, user)` positionally and mocks `activityEngine.handleReconnect` — Task 7's third positional arg fits cleanly. ✅

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** WARN — none. Modular-monolith boundaries respected: the engine resolves via its own injected `@InjectRepository(ModuleSession)` repo, the controller delegates and only maps transport. No cross-module entity injection introduced.
- **Rules (`RULES.md`):** Aligned. The rule "Always use `@Payload()` on the request parameter in gRPC methods that also use `@GrpcCurrentUser()`" applies because adding `@GrpcMetadataValue(...)` keeps the method in explicit-injection mode. Task 4 explicitly preserves `@Payload()` alongside `@GrpcCurrentUser()` and the new decorator — compliant. Flagging so the implementer does **not** drop `@Payload()`.
- **Roadmap (`ROADMAP.md`):** WARN — this realtime reconnect milestone is not represented as an explicit `[ ]` line in the current ROADMAP (which is mid-way through later phases). Non-blocking for a plan review, but worth confirming the milestone is tracked.

## Critical Issues

### 1. Commit 1 (tasks 1–3) leaves the build broken — controller won't typecheck against the widened return type
Task 3 widens `handleReconnect` to `Promise<ModuleSession | { abandoned: true } | null>` and is committed in **Commit 1**, but the controller is not updated until **Commit 2** (tasks 4–5). In the interim, `module-state.grpc.controller.ts:110-113` still does:

```ts
if (session) {
  subscriber.next({ sessionState: { moduleSessionId: session.id, ... } });
```

After the truthy narrow, `session` is `ModuleSession | { abandoned: true }`, and `session.id` does not exist on the `{ abandoned: true }` arm → `tsc` error. The intermediate commit does not compile, which fails `npm run build` / CI per commit.

**Fix:** fold Task 3 into the same commit as Tasks 4–5 (engine + controller change ship together), or reorder so the controller branch (Task 5) lands in the same commit that widens the signature. Adjust the Commit Plan accordingly.

### 2. `moduleSessionId` is a required `string`, but Task 5 assigns `clientSessionId: string | undefined`
Task 5 emits `subscriber.next({ sessionState: { status: ActivityStatus.ABANDONED, moduleSessionId: clientSessionId } })`. The proto `SessionState.moduleSessionId` is a required `string` (not optional). `clientSessionId` is closed over from the `@GrpcMetadataValue(...)` param, typed `string | undefined`. The abandoned branch is only *reachable* when `clientSessionId` was provided (engine path 2 requires it), but TypeScript cannot narrow that across the closure boundary, so the assignment is a compile error.

**Fix:** narrow at the emit site — e.g. assign the resolved value to a local that is provably a string before constructing the event, or use `moduleSessionId: clientSessionId ?? ''`. Prefer the narrowed-local form so an empty string never reaches the client; add this instruction to Task 5.

## Notes / Non-blocking

### 3. Task 1 wording — the new constant is a string key, not a Symbol like its neighbors
Task 1 says to add `GRPC_MODULE_SESSION_ID_KEY = 'module-session-id'` "beside the existing `GRPC_USER_KEY` / `GRPC_TOKEN_KEY`." Those two are **Symbols** used to stash interceptor-injected data on the metadata object (read as `(metadata as any)[GRPC_USER_KEY]`), whereas the new key is a real wire metadata string read via `metadata.get(...)`. Co-locating the constant is fine; just ensure the implementer follows Task 2's `metadata.get(key)[0]?.toString()` mechanism and does **not** mirror the Symbol-property pattern. The plan is internally consistent here — this is a guard against misreading.

### 4. Scope of abandonment detection — DISCONNECTED/orphaned rows resolve to silence
Engine path 2 emits `{ abandoned: true }` only when the DB row is already `SessionStatus.ABANDONED`. A row left in `DISCONNECTED` (or `ACTIVE`) with no in-memory store entry — e.g. after a server restart, before the stale watchdog marks it `ABANDONED` — resolves to `null` (silent). This matches the plan's stated "stays silent otherwise (backward-compatible idle behavior)" and is a defensible design choice, but confirm against `docs/realtime/session-lifecycle.md` that a restart-orphaned grace session is expected to be reconciled by the watchdog rather than answered authoritatively on this reconnect.

### 5. Test for `findOne` query shape
Task 6 (e) asserts `findOne` is queried with `{ id: clientSessionId, userId }`. Good — the `userId` scoping is a genuine security improvement (prevents a client from resolving another user's session id). Make sure Task 6's mock assertion checks `where` includes `userId`, not just `id`, so this scoping cannot regress silently.

## Positive Notes

- Resolution order is explicit, flag-free, and correctly keeps grace/watchdog (`abandonActivity`/`abandonStale`) as the sole writers of the DB `ABANDONED` row — no resurrection, no auto-create.
- The enum trap (DB `SessionStatus.ABANDONED` vs proto `ActivityStatus.ABANDONED`) is called out explicitly in Task 3 — exactly the kind of mistake this distinction prevents.
- "Keep the stream open — no `subscriber.complete()`" is correct and matches the existing `setup()` flow so the client can immediately `activity:start`.
- `userId`-scoped `findOne` prevents cross-user session-id resolution.
- Test plan covers all five engine branches and the four controller branches, including the stream-stays-open case after an abandoned emit.

## Required changes before implementation
1. Reorder/merge the commit plan so the engine signature widening and the controller branch ship in one compiling commit (Issue 1).
2. Add an explicit narrowing instruction for `moduleSessionId` in Task 5 so the abandoned emit typechecks and never sends an empty/undefined id (Issue 2).

Address Issues 1 and 2 (both produce compile errors as written); Notes 3–5 are advisory.
