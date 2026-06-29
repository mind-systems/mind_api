# Test plan — pause-state integrity across reconnect (silent-bug-first, TDD)

**Date:** 2026-06-29
**Source:** conversation context

Covers feature task [[24-pause-state-integrity]]. Written **before** the feature: committed RED, turns GREEN when note 24 lands. (Marker *durability* — that a `PAUSED`/`RESUMED` marker survives a crash — is the foundational task [[25-persist-ispaused]], tested separately by [[30-test-immediate-marker-persistence]]; not retested here.)

## Test authoring constraints
- **L1 — outcomes only:** assert the in-memory `ActivityState.isPaused` (via `store.getSession(userId, sid)?.isPaused`), the emitted `StateResponse.sessionState.isPaused`, and whether `unpauseActivity` throws — never private internals.
- **L2 — compile-now:** no new symbols here; `isPaused` already exists on `ActivityState` (`interfaces/activity-state.interface.ts`). There is **no `isPaused` column ever** (note 25 makes the timeline marker durable, not a column) — pause lives on the in-memory `ActivityState`; see two-state precision below.
- **L3 — label by spec name:** target cases `RED until spec 24-pause-state-integrity`.
- **L4 — escalation valve:** the pause/unpause guards are characterization. A RED there after note 24 = regression, escalate.

## Why this area (silent-failure filter)
The server flips pause state it does not own: `resumeActivity` resets `state.isPaused = false` on **every** reconnect (`activity-engine.service.ts:573`) and the reconnect `session:state` reports `isPaused: false` **hardcoded** (`module-state.grpc.controller.ts:142`). A session the user paused silently returns active, and the next `activity:resume` is silently rejected `NOT_PAUSED` (`:508`). No error, no crash — pure silent state corruption.

## Scope boundary — durability is elsewhere
This note tests pause **correctness** (the server must not flip pause it does not own, and must report the real flag). Marker **durability** — that the `PAUSED`/`RESUMED` marker survives a crash — is the foundational task [[25-persist-ispaused]] (all `SESSION_EVENT` markers persist immediately at emit), tested by [[30-test-immediate-marker-persistence]]. Not retested here.

## Two-state observability — the load-bearing precision
There is **no `isPaused` column** (note 25 makes the marker durable, not a column): `handleReconnect` returns a `ModuleSession` entity with **no** `isPaused` field. The reconnect emission must therefore read the live flag from the **in-memory `ActivityState`**, never off the returned entity.

But the controller has **no `ActivitySessionStore` dependency** — its ctor is `(activityEngine, rateLimiterService, activeStreamRegistry, configService, eventEmitter)` (`module-state.grpc.controller.ts`), and the reconnect emission today hardcodes `false`. So note 24 must **surface the live `isPaused` through the `ActivityEngine`** (the engine owns the store): either `handleReconnect` returns the live flag alongside the session, or the controller reads `activityEngine.getSession(userId, result.id)?.isPaused`. The controller spec mocks the **entire** engine, so the controller-emission target mocks the engine to surface a paused state and asserts the emission — a clean vantage. **Do NOT** assert `isPaused` read off the bare `result` `ModuleSession` (the field never exists — there is no column → malformed, permanently RED). Pin the chosen surfacing mechanism (escalate to note 24) before authoring that case.

## Red/Green contract
- **Target (RED until [[24-pause-state-integrity]]):** resume preserves `isPaused`; reconnect emission reports the actual flag; subsequent `unpause` succeeds.
- **Characterization (GREEN, stay GREEN):** `pauseActivity`/`unpauseActivity` guards (`ALREADY_PAUSED`/`NOT_PAUSED`) and their `true`/`false` writes; `pauseActivity` still pushes the `PAUSED` marker.

## Instantiation
`ActivityEngine(repo, activitySessionStore, eventEmitter, streamEngine)` with a **real** `ActivitySessionStore` for the resume/unpause targets — seed a paused child via `addChild(userId, sid, { ..., isPaused: true })`. For the reconnect-emission target, `ModuleStateGrpcController` with the mocked `activityEngine` (`makeActivityEngine`, controller spec :28) — surface a paused state per the pinned mechanism and assert the captured `StateResponse`.

## Test cases
### Resume preserves pause (target → 24)
- After `resumeActivity` on a session seeded `isPaused: true`, `store.getSession(userId, sid)?.isPaused` is **still `true`** (the `:573` reset is gone). RED now (reset to false) → GREEN after.
- A subsequent `unpauseActivity(userId, sid)` **does not throw** `NOT_PAUSED` (it was still paused). RED now → GREEN after.
### Reconnect emission (target → 24)
- The reconnect `session:state` reports `isPaused` reflecting the **actual** resumed state (true when paused) — not hardcoded `false`. Drive via the engine-surfaced flag (pinned mechanism), assert `sessionState.isPaused === true`.
### Unchanged (characterization)
- `pauseActivity` on an already-paused session still throws `ALREADY_PAUSED`; `unpauseActivity` on a non-paused session still throws `NOT_PAUSED`; both still write `true`/`false`; `pauseActivity` still pushes the `PAUSED` marker.

## Anti-targets (DELETE or INVERT — enumerated by file:line)
- **`module-state.grpc.controller.spec.ts:152-174`** — `it('should emit StateResponse.sessionState with status RESUMED and isPaused false when handleReconnect returns a session')`, assertion `toMatchObject({ status: RESUMED, isPaused: false })` at `:169-171`. This pins the **OLD hardcoded** `isPaused: false` (`module-state.grpc.controller.ts:142`). After note 24 the emission reflects the actual flag, and with no store mock set up the emitted value would no longer be a hardcoded `false` → this case false-REDs. **INVERT into two cases:** (a) resumed **unpaused** session → `isPaused: false` read from the surfaced state; (b) resumed **paused** session → `isPaused: true`. Note 24 must update this case when it lands.
  - **Cross-epic collision:** this same case is **also** an anti-target in the generic session-data-flow test note [[31-test-root-id-on-connect]] (F1 adds a root `session:state` on connect, inverting the `:167 toHaveLength(1)` to length 2 — `[RESUMED, ROOT]`). The generic epic is above `---STOP---` and lands **first**, so by the time this durability case is touched the test already asserts the length-2 `[RESUMED, ROOT]` shape. Reconcile this note's `isPaused` inversion **on top of** that shape (assert `isPaused` on the `values[0]` RESUMED frame; the `values[1]` ROOT frame carries `is_root=true` and a separate `isPaused`). Do not revert the generic epic's change.
- **`activity-engine.service.spec.ts` `resumeActivity` block (`:577-606`)** — NOT an anti-target. It asserts only `status`/`disconnectedAt`/`lastActivityAt`/`repo.save`/store `lastActivityAt`; the `isPaused: false` at `:585` (and `:621`) are **fixture seeds**, not assertions. Removing the `state.isPaused = false` line breaks no assertion here. Stated explicitly so the implementer does not "fix" a fixture.
- No other committed case asserts the old `isPaused`-reset or hardcoded-`false` behavior.

## Gotchas
- The resume-preserve and unpause-succeed targets run purely on the in-memory `ActivityState` (which already has `isPaused`) — they need **no** column and are fully observable at note-24 time.
- Only the controller-emission target depends on note 24's surfacing mechanism — pin it before writing that case, or it sits malformed.
- Distinguish fixture `isPaused: false` seeds from assertions when scanning — most occurrences are seeds.

## Findings / escalation to note 24
1. Remove `state.isPaused = false` from `resumeActivity`.
2. Surface the live `isPaused` to the reconnect emission **through the `ActivityEngine`** (the controller has no store) — pin the exact shape (return value vs `activityEngine.getSession`).
3. Update anti-target `module-state.grpc.controller.spec.ts:152-174` (invert to actual-state assertions).
