# Plan: Tests: per-service stream eviction, CONNECTION_SUPERSEDED + supersede-children

## Context
TDD-first companion test task that lands **before** the per-service stream-eviction feature (note 47). It edits three committed spec files to lock in the new single-slot-per-`(userId, service)` eviction contract: registry eviction + `onEvict` pre-complete hook, the STATE controller's `CONNECTION_SUPERSEDED`/`supersedeChildren` takeover branch, and `ActivityEngine.supersedeChildren` (children ended `INTERRUPTED`, root untouched, store cleared synchronously). New targets are expected **RED** until note 47 lands — this is intentional; do not soften them to pass.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Notes for the implementer
- **This IS a test task.** The deliverable is the edited `.spec.ts` files only. Do NOT touch `active-stream-registry.service.ts`, `module-state.grpc.controller.ts`, or `activity-engine.service.ts` — those are the feature task's (note 47) job.
- **RED is expected.** New/rewritten targets will fail to compile or fail assertions today (`register` has no `service`/`onEvict` params, `deregister` has no return value, `supersedeChildren` does not exist). That is the correct TDD state; the follow-up feature task turns them GREEN. Characterization cases must stay GREEN.
- **Spec is authoritative.** `.ai-factory/notes/46-test-per-service-stream-eviction.md` gives exact test bodies and per-case rationale (sections A1–A6, B1–B4, Part C). Follow it verbatim; the sections below map tasks to it.
- **The service-arg trap (note §"Grounded finding").** `register`/`deregister` widen from `(userId, subscriber)` to `(userId, service, subscriber)`. Do NOT blindly paste one uniform `StreamService.STATE` into every call — same-`userId` multi-register cases that expect coexistence must use **distinct** services, or eviction silently collapses them (see Task 2). The trap also hits **assertion** sites: every existing `toHaveBeenCalledWith` on `register`/`deregister` asserts the old 2-arg shape and will fail after the feature lands unless updated — sweep **all** of them, not just the ones the note names by line (see Task 4).
- **`StreamService` import (all three specs).** `StreamService` (`STATE`/`INSTRUCTION`/`BIO`/`SYNC`) is introduced by note 47 at `constants/stream-service.ts` — it does **not** exist yet. Each of the three edited specs must add the import (`../constants/stream-service` from `services/`, `./constants/stream-service` from the realtime root). The unresolved import is a legitimate compile-level RED until note 47 — it is part of the edit, not an accident.
- **Line numbers drift.** The note's `:NN` anchors are approximate against HEAD (a few lines off in the two larger files). Locate cases by their `it(...)` description, not the literal line.

## Tasks

### Phase 1: Part A — `active-stream-registry.service.spec.ts`

- [x] **Task 1: Split the anti-target + add the eviction/`onEvict`/ordering targets**
  Files: `src/realtime/services/active-stream-registry.service.spec.ts`
  Per note §A1, §A1b, §A1c, §A2:
  - §A1 — replace the single `:32-38` "add a second subscriber ... without replacing" case with **two**: (a) NEW TARGET "should evict (complete) the prior subscriber when registering a second one for the same (userId, service)" — spy on `sub1.complete`, register `sub1` then `sub2` under `StreamService.STATE`, assert `complete` called once and `size === 1`; (b) REWRITTEN CHARACTERIZATION "should keep both subscribers live when registering for different services under the same userId" — register `sub1` under `STATE`, `sub2` under `INSTRUCTION`, assert `size === 2`, neither completed.
  - §A1b — add "should invoke the optional onEvict callback with the evicted subscriber before calling complete() on it" (assert `onEvict` runs before `complete`, called with `sub1`), plus two characterizations: `onEvict` passed but never fired on a first-ever register, and not fired on re-registering the identical subscriber.
  - §A1c — add the end-to-end ordering proof "should emit session_error CONNECTION_SUPERSEDED then complete, in that order, on STATE eviction" against the real registry, using an `onEvict` that pushes `{ sessionError: { code: 'CONNECTION_SUPERSEDED', ... } }`; assert `next` fired with that frame and `next`'s `invocationCallOrder` precedes `complete`'s.
  - §A2 — strengthen the `:52-57` idempotent case: add the `service` arg (`StreamService.STATE` on both calls), keep `size === 1`, and add `expect(completeSpy).not.toHaveBeenCalled()` (spy set before the second register) to prove the identity guard skips self-eviction.

- [x] **Task 2: Rewrite the 5 same-userId multi-register cases; mechanically insert the service arg everywhere else** (depends on Task 1)
  Files: `src/realtime/services/active-stream-registry.service.spec.ts`
  Per note §A3 and §A4:
  - §A3 — rewrite these five so each same-`userId` registration uses a **distinct** `StreamService` (otherwise eviction collapses them and they pass/fail for the wrong reason): `closeAll` "should call complete() on every subscriber for the given userId" (`STATE`+`INSTRUCTION`); "should delete the user's Set after completing all subscribers" (same fix); `size` getter "should return the sum of subscribers across all users" (`user1`→`STATE`/`INSTRUCTION`/`BIO`, `user2`→`STATE`/`INSTRUCTION`, still `size === 5`); "should decrease by 1 when one subscriber is deregistered" (`STATE` for `sub`, `INSTRUCTION` for the second); `onModuleDestroy` "should call complete() on every subscriber across all users" (`user1`'s two → distinct services).
  - §A4 — insert a uniform `StreamService.STATE` (safe: one subscriber per userId or distinct userIds) into all remaining cases: initial-state first register, separate-Sets-per-user, all of `deregister()`, the remaining `closeAll()` single-register cases, `size` "0 after closeAll", and `onModuleDestroy`'s remaining single-register cases. `deregister` calls gain the `service` arg too.

- [x] **Task 3: Add the reachability/leakage guard targets (A5 optional, A6 required)** (depends on Task 2)
  Files: `src/realtime/services/active-stream-registry.service.spec.ts`
  Per note §A5, §A6:
  - §A5 (optional, recommended) — "should not mark a subscriber as evicted when it is registered, deregistered, then a fresh subscriber registers for the same slot": assert `deregister` returns `false` for an ordinary deregister-then-fresh-register sequence (WeakSet bookkeeping guard).
  - §A6 (required) — three cases proving the supersede signal cannot leak: "should NOT mark a subscriber as evicted when it is completed via closeAll" (`deregister` after `closeAll` returns `false`); "should NOT mark a subscriber as evicted when it is completed via onModuleDestroy" (same shape via `onModuleDestroy`); "should evict via a bare complete() with no session_error when no onEvict argument is supplied" — register `sub1`/`sub2` under `BIO` with no `onEvict`, assert `sub1.complete` called once and `sub1.next` **never** called (the bio/instruction/sync shape emits no pre-complete frame).

### Phase 2: Part B — `module-state.grpc.controller.spec.ts`

- [x] **Task 4: Factory defaults + mechanical 3-arg updates + genuine-drop negative assertion** (depends on Task 3)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Per note §B1, §B2:
  - §B1 — give `makeActiveStreamRegistry()` an explicit `deregister: jest.fn().mockReturnValue(false)` default; add `supersedeChildren: jest.fn()` to the shared `makeActivityEngine()` factory. Update the three `deregister`/teardown assertions from 2-arg to `toHaveBeenCalledWith(user.sub, StreamService.STATE, expect.any(Subscriber))`: the "deregister when the consumer unsubscribes" case, "run teardown when the request observable completes", "run teardown when the request observable errors".
  - **Sweep the two existing `register` 2-arg assertions too** (the note enumerates only `deregister` sites — these are the gap the review caught; without them the suite goes RED-forever after the feature lands, violating the characterization contract). After note 47 the STATE controller calls `register(userId, StreamService.STATE, subscriber, onEvict)` (4 args), and `toHaveBeenCalledWith` demands an exact match:
    - "should call activeStreamRegistry.register(user.sub, subscriber) when user is present" (`:141-152`) — update the assertion to `toHaveBeenCalledWith(user.sub, StreamService.STATE, expect.any(Subscriber), expect.any(Function))`.
    - "should still register the subscriber with activeStreamRegistry before setup runs" (`:736-752`) — same 4-arg update.
    These two overlap Task 5's B4 wiring assertion; keep them as the plain "register is invoked with the right shape" characterization (they must stay GREEN through the feature), and let B4 own the callback-behavior proof.
  - §B2 — leave the genuine-drop characterization "should call activityEngine.handleTransportDisconnect(userId) on teardown" unmodified (confirm it stays GREEN under the `false` default), and add `expect(activityEngine.supersedeChildren).not.toHaveBeenCalled()` to that case (or a sibling). Confirm the `:681-690`-region genuine-drop characterization is untouched by this feature.

- [x] **Task 5: New takeover-branch + `onEvict`-wiring targets** (depends on Task 4)
  Files: `src/realtime/module-state.grpc.controller.spec.ts`
  Per note §B3, §B4 (both RED until note 47):
  - §B3 — "should call activityEngine.supersedeChildren (not handleTransportDisconnect) when the teardown was caused by eviction (registry.deregister returns true)": set `deregister.mockReturnValue(true)`, run `setupConnectedStream` + `sub.unsubscribe()`, assert `supersedeChildren` called with `user.sub` and `handleTransportDisconnect` **not** called.
  - §B4 — "should register the STATE stream with an onEvict callback that pushes a CONNECTION_SUPERSEDED session_error on the evicted subscriber": assert `register` called with `(user.sub, StreamService.STATE, expect.any(Subscriber), expect.any(Function))`; capture the 4th arg, invoke it against a fake `{ next }`, assert it pushes `{ sessionError: expect.objectContaining({ code: 'CONNECTION_SUPERSEDED' }) }`.

### Phase 3: Part C — `activity-engine.service.spec.ts`

- [x] **Task 6: `supersedeChildren` coverage — race-safety, ends-children/root-untouched, no-op** (depends on Task 5)
  Files: `src/realtime/services/activity-engine.service.spec.ts`
  Per note §Part C. Seed via the multi-session API (`activitySessionStore.setRoot(...)` + `activitySessionStore.addChild(...)`), not the legacy single-slot `set(...)`. Add `describe('supersedeChildren', ...)` with:
  - PRIMARY TARGET (race-safety, RED) — "should clear the store synchronously, before the first DB await resolves": make `repo.findOne` return a manually-controlled unresolved promise, call `engine.supersedeChildren('user-1')` **without awaiting**, assert `activitySessionStore.listChildren('user-1')` is already empty, then resolve and await. **Also stub `repo.save.mockImplementation((s) => Promise.resolve(s))`** — the note's race-safety snippet stubs only `repo.findOne`, but after the promise resolves `supersedeChildren` calls `repo.save` (default `jest.fn()` → `undefined`), then reads `saved.id`, which throws and rejects `await pending`, failing the test **even against a correct implementation**. Do not omit this stub. (A naive `for … await stopActivity` loop still fails the synchronous-clear assertion — it is the load-bearing case.)
  - TARGET — "ends children (terminal status), leaves the root ACTIVE": seed root + 2 children, assert `repo.save` called exactly twice with `{ status: SessionStatus.INTERRUPTED, endedAt: expect.any(Date) }` per child (never a 3rd for the root); `listChildren` empty; root untouched — `getRootId` unchanged, `getRoot` returns the **same reference**, `repo.findOne`/`repo.save` never called for the root id. Also assert the marker + event side effects per child, **mirroring the existing ABANDONED tests' shape** (`:345-352,396-409,444-457` — there are **no `stopActivity`/`INTERRUPTED` tests in this file** to copy, so the note's "grep `SessionEvents.INTERRUPTED`" pointer resolves to nothing; use the ABANDONED cases as the template and swap the status): the emitter mock is named **`emitter`** (not `eventEmitter`) — `emitter.emit(SessionEvents.INTERRUPTED, expect.objectContaining({ sessionId, userId }))`; and `streamEngine.push` takes `(sessionId, { data: expect.objectContaining({ dataType: StreamDataType.SESSION_EVENT, event: StreamSessionEvent.INTERRUPTED }) })` — **not** a bare event value. Assert **`endedAt`, not `disconnectedAt`** (per note §Part C field-choice rationale — a superseded child is cut from ACTIVE, never DISCONNECTED).
  - CHARACTERIZATION — "no-op when there are no children": root-only or empty seed → `repo.save` never called, resolves without throwing.

## Commit Plan
- **Commit 1** (after tasks 1-3): "Add per-service eviction and CONNECTION_SUPERSEDED tests to active-stream-registry spec"
- **Commit 2** (after tasks 4-5): "Add supersede-children takeover and onEvict wiring tests to module-state controller spec"
- **Commit 3** (after task 6): "Add supersedeChildren coverage to activity-engine spec"
