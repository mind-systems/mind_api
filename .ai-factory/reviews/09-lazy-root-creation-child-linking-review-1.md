# Code Review: 09 — Lazy root creation + child linking

**Reviewed:** working-tree + staged changes vs `HEAD` (`c9f3e21`).
**Files with code changes:**
- `src/realtime/services/activity-engine.service.ts` — `ensureRoot`, `startActivity` child-linking, root-skip guards.
- `src/realtime/module-state.grpc.controller.ts` — `ensureRoot` call in `setup()`.

**Verdict:** 🔴 Changes request — production logic is correct, but the change is **incomplete**: it breaks **37 previously-green tests** by introducing a new `ActivityEngine` method that existing test mocks don't stub.

---

## Verification of intended behavior (correct)

- `ensureRoot` idempotent branch issues zero `repo.create`/`repo.save` and returns a synthesized `ModuleSession` with `id = getRootId(userId)`; create branch persists `activityType=root, rootSessionId=null, status=active` and registers it via `setRoot`. Matches the target tests.
- `startActivity` links children via a **read-only** `getRootId(userId)` lookup (no `ensureRoot` call inside the engine), and assigns `session.rootSessionId = rootId` onto the created instance — both review-1 required fixes are correctly applied.
- Root-skip guards added to `endActivity`/`stopActivity` (return `null`) and `pauseActivity`/`unpauseActivity` (throw `NO_ACTIVE_SESSION`); `onDisconnect`/`abandonActivity`/`resumeActivity`/`handleReconnect`/`handleTransportDisconnect` are correctly left untouched so the root still goes `disconnected→abandoned` on grace and resumes on reconnect.
- Controller materializes the root after `handleReconnect`, behind `if (subscriber.closed) return;`, before subscribing to commands.
- Target suite `multi-session-lifecycle.spec.ts`: **17/17 green** (was 15/17 at HEAD — the 2 target tests now pass).
- Migrations already exist (`AddRootActivityType`, `AddRootSessionLink`); no new migration needed. ✅

---

## Critical

### C1. New `ensureRoot` call breaks 37 previously-green tests — dependent engine mocks not updated

`module-state.grpc.controller.ts:142` now calls, on every stream connect:

```ts
if (subscriber.closed) return;
await this.activityEngine.ensureRoot(userId);
```

The existing controller-spec mock factories build `ActivityEngine` by hand and **do not include `ensureRoot`**:

- `src/realtime/module-state.grpc.controller.spec.ts:28-39` `makeActivityEngine()` — no `ensureRoot`.
- `src/realtime/concurrency-idempotency.spec.ts:60` `makeActivityEngine()` — no `ensureRoot`.

So `this.activityEngine.ensureRoot` is `undefined`, the call throws `TypeError: this.activityEngine.ensureRoot is not a function`, which rejects `setup()`. The rejection is caught by `setup().catch(...)`, which emits `Stream setup failed` and calls `subscriber.complete()` — so the request observable is **never subscribed** and no command ever routes. Every test that drives a command through the stream fails (`startActivity`/`endActivity`/`pause`/… "Number of calls: 0").

**Measured regression (green at HEAD → red with the change):**

| Spec | HEAD | With change |
|---|---|---|
| `module-state.grpc.controller.spec.ts` | 63 passed | **30 passed / 33 failed** |
| `concurrency-idempotency.spec.ts` | 4 passed / 7 failed* | **0 passed / 11 failed** |

\* the 7 pre-existing failures are `[TARGET — RED until spec 06]` and are out of scope; the **4** that were green regressed.

The production code is correct (the real `ActivityEngine` has `ensureRoot`), so this is not a runtime bug — but the deliverable leaves 37 characterization tests red. Under this project's TDD contract (characterization tests must stay green; a green→red is a Class-B regression to escalate, not ignore), a broken suite is a blocker.

**Fix:** add `ensureRoot` to both mock factories, e.g.

```ts
ensureRoot: jest.fn().mockResolvedValue(makeSession()),
```

in `module-state.grpc.controller.spec.ts:makeActivityEngine()` (line 28) and `concurrency-idempotency.spec.ts:makeActivityEngine()` (line 60). After this, re-run `npx jest src/realtime/module-state.grpc.controller.spec.ts` and `npx jest src/realtime/concurrency-idempotency.spec.ts` to confirm the previously-green tests are restored.

> Note on scope: the other two realtime suites that fail (`session-watchdog.service.spec.ts` → `sweepEmptyRoots is not a function`, Phase 57; `module-biometric-stream.grpc.controller.spec.ts` → `[RED until spec 10]`, Phase 58) are **pre-existing RED-until-future** and are **not** caused by this change. `module-instruction-stream.grpc.controller.spec.ts` mocks the engine but its controller never calls `ensureRoot`, so it is unaffected (stays green).

---

## Minor / informational

### M1. Concurrent connects for the same user can mint duplicate roots
`ensureRoot` is only concurrency-safe *within a single connect* (the controller awaits it before routing commands). Two overlapping state-stream connects for the same user (e.g. multi-device) can both observe `getRoot(userId) === undefined` before either `setRoot` lands, each creating a root row; the second `setRoot` overwrites the first in the store, orphaning the first root row, and a child started on the losing connection links to a root that is no longer the store's root. The spec deliberately defers empty/orphan-root cleanup to the janitor (Phase 57), so this is an acknowledged model limitation rather than a defect — flagging it so it isn't mistaken for "exactly one root per user" guaranteed at the store level.

### M2. Synthesized `ModuleSession` in the idempotent branch omits entity fields
The idempotent return (`activity-engine.service.ts:81-90`) builds a partial object cast `as ModuleSession`, omitting `disconnectedAt`, `endedAt`, `metadata`, `createdAt`. Harmless today (the only production caller — the controller — ignores the return), but a future caller reading those fields would get `undefined`. Acceptable as-is; noted for awareness.

---

## Required before merge
1. **C1 (blocker):** add `ensureRoot` to the `makeActivityEngine()` mock in `module-state.grpc.controller.spec.ts` and `concurrency-idempotency.spec.ts`, restoring the 37 regressed tests. Re-run the full `npx jest src/realtime` suite and confirm only the pre-existing RED-until-future tests (Phase 56/57/58) remain red.
