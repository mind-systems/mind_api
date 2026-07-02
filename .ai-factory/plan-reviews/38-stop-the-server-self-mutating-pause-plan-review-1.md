# Plan Review: Stop the server self-mutating pause

**Plan:** `.ai-factory/plans/38-stop-the-server-self-mutating-pause.md`
**Spec:** `.ai-factory/notes/24-pause-state-integrity.md`
**Files Reviewed:** 2 target files + store, interface, specs, ROADMAP
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture:** ✅ PASS. The change respects the modular-monolith boundary. Task 2 explicitly avoids adding an `ActivitySessionStore` dependency to the controller and instead reads through the already-injected `ActivityEngine` (thin delegate). Controllers stay thin — logic/state ownership remains in the engine/store. No cross-module internal imports introduced.
- **Rules:** ✅ PASS. No migration (pause is not a column — confirmed: `ActivityState.isPaused` is in-memory only, no `module_sessions` pause column). No proto change (`is_paused` already exists on the state event). Logging left untouched (the plan says "minimal" and touches no logs).
- **Roadmap:** ✅ PASS. Directly linked to Phase 62 — *"Stop the server self-mutating pause"* (`ROADMAP.md:137`). Plan scope matches the roadmap task and its spec verbatim.

## Verification Against the Codebase

Every load-bearing claim in the plan was checked against the current source:

- **Task 1 line target is correct.** `state.isPaused = false;` is at `activity-engine.service.ts:598`, immediately after `state.lastActivityAt = now;` (`:597`), inside `resumeActivity`. Deleting exactly this line is the correct and complete fix for the in-memory reset. The `pauseActivity` (`:500` write `true`, `:496` guard) and `unpauseActivity` (`:535` write `false`, `:531` guard) writes are left intact, as instructed.
- **Task 2 line target is correct.** The reconnect RESUMED emission block is at `module-state.grpc.controller.ts:169-176`; the hardcoded `isPaused: false` is `:173`, and the adjacent `activityType: mapInternalActivityType(result.activityType)` is `:174`. The plan correctly isolates the edit to `:173` and preserves `:174`, `moduleSessionId`, and `status: RESUMED`.
- **Proposed one-liner is API-accurate.** `activityEngine.getSession(userId, sessionId): ActivityState | undefined` exists at `activity-engine.service.ts:554` (plan says 554 — matches current code; the spec note's `:537` is stale but the plan corrected it). It delegates to `ActivitySessionStore.getSession` (`activity-session-store.service.ts:108`), a child-or-root lookup that returns the live `ActivityState` carrying `isPaused`. The `?? false` correctly coerces the resumed-unpaused / not-found case to a real boolean.
- **State survives to emission time.** On a normal reconnect the store retains the entry — `resumeActivity` only removes the session when the DB row is missing (returns `null`, so no frame is emitted anyway). After Task 1 the in-memory `isPaused` is no longer reset, so `getSession(userId, result.id)` at emission time returns the preserved flag. The mechanism is sound for both the sole-child and root-only reconnect shapes (`handleReconnect` returns `soleChildResult ?? rootResult ?? null`; root `isPaused` is always `false`, which is correct).
- **The "traps" the plan warns against are real.** `handleReconnect` returns a `ModuleSession` entity with no `isPaused` field, so reading `result.isPaused` would be permanent `undefined` — the plan correctly forbids this. The controller ctor (`activityEngine, rateLimiterService, activeStreamRegistry, configService, eventEmitter`) has no store dependency — the plan correctly routes through the engine instead.
- **Only two self-mutation spots exist.** A full `isPaused` sweep of `src/realtime` confirms the write sites are: `:160`/`:204` (init `false` on create), `:500`/`:535` (client pause/unpause), `:598` (the bug), and controller `:173` (the hardcode) / `:537`/`:573` (legit pause/unpause emissions). The plan targets exactly the two bug sites and no others.

## Test Alignment (no new tests needed — "Testing: no")

The already-committed RED tests match the proposed change exactly, so this plan turns them GREEN without further test work:

- `module-state.grpc.controller.spec.ts:159` case (a): `getSession` returns `undefined` → expects `isPaused: false`. The one-liner yields `undefined?.isPaused ?? false === false`. ✅
- `module-state.grpc.controller.spec.ts:189` case (b): `getSession.mockReturnValue({ isPaused: true })` → expects `isPaused: true`. The one-liner yields `true`. ✅ (`getSession` mock is already wired into the factory.)
- `activity-engine.service.spec.ts:1095` Case A: resume must not reset `isPaused` when paused before reconnect. Deleting `:598` makes this pass. ✅
- `activity-engine.service.spec.ts:1131` Case B: after reconnect a paused session's `unpause` must not throw `NOT_PAUSED`. ✅

## Missing Steps / Wrong Assumptions

None found. Line numbers, method signatures, dependency constraints, and the no-migration/no-proto claims all check out against the current tree.

## Positive Notes

- The plan pins the exact fix as a single-line delete plus a single-field edit, with explicit anti-instructions ("do not read `result.isPaused`", "do not add a store dep", "preserve `activityType`") that prevent the two most likely wrong implementations.
- Correctly recognizes this fixes only the in-memory reconnect case and defers server-restart survival to the durable-marker derive path (Phase 63 / note 26) — no scope creep, no premature column.
- Line references were re-verified against current code rather than copied from the spec note (which carried a stale `:537`/`:573`/`:142` numbering) — the plan's numbers are the correct ones.

PLAN_REVIEW_PASS
