# Code Review (round 2): 09 — Lazy root creation + child linking

**Reviewed:** working-tree + staged changes vs `HEAD` (`c9f3e21`).
**Production files changed:** `src/realtime/services/activity-engine.service.ts`, `src/realtime/module-state.grpc.controller.ts` (both unchanged since round 1).
**Test files changed since round 1:** `src/realtime/module-state.grpc.controller.spec.ts`, `src/realtime/concurrency-idempotency.spec.ts`.

**Verdict:** ✅ Pass — the round-1 blocker is resolved and no new issues were introduced.

---

## Round-1 blocker (C1) — resolved

Round 1 flagged that the new `await this.activityEngine.ensureRoot(userId)` in the controller's `setup()` threw `TypeError: ensureRoot is not a function` against test mocks that didn't stub the method, rejecting `setup()` and turning 37 previously-green tests red.

Both `makeActivityEngine()` factories now stub it:
- `module-state.grpc.controller.spec.ts:31` → `ensureRoot: jest.fn().mockResolvedValue(makeSession())`.
- `concurrency-idempotency.spec.ts:64` → `ensureRoot: jest.fn().mockResolvedValue({ id: 'root-session-1' })`.

The stubs are sufficient — the controller awaits `ensureRoot` only for its side effect (it ignores the return), so any resolved value lets `setup()` proceed to subscribe and route commands.

**Re-run results (vs HEAD baseline):**

| Spec | HEAD | Round 1 | Round 2 |
|---|---|---|---|
| `multi-session-lifecycle.spec.ts` (this milestone's targets) | 15/17 | 17/17 | **17/17 ✅** |
| `module-state.grpc.controller.spec.ts` | 63/63 | 30/63 | **63/63 ✅** |
| `concurrency-idempotency.spec.ts` | 4 pass / 7 fail | 0 pass / 11 fail | **4 pass / 7 fail ✅ (baseline restored)** |

The 4 previously-green concurrency tests are restored; the 7 still-red ones are all tagged `[TARGET — RED until spec 06]` (Phase 56) and are out of scope for this milestone (Phase 55).

## Out-of-scope failures (pre-existing, not caused by this change)

`npx jest src/realtime` → 3 suites fail / 15 failed tests, all RED-until-future:
- `session-watchdog.service.spec.ts` → `sweepEmptyRoots is not a function` (Phase 57 janitor, spec 08).
- `module-biometric-stream.grpc.controller.spec.ts` → `[RED until spec 10-bio-ingest-to-root]` (Phase 58).
- `concurrency-idempotency.spec.ts` → the 7 `[TARGET — RED until spec 06]` cases (Phase 56).

None are introduced or worsened by this milestone.

## Production logic — re-confirmed correct

The engine/controller diff is identical to round 1 (verified line-by-line): `ensureRoot` idempotent zero-write reuse + create-and-register; `startActivity` read-only `getRootId` linking with the post-`create` instance assignment; root-skip guards on `end`/`stop`/`pause`/`unpause` only; controller materializes the root behind `if (subscriber.closed) return;` before subscribing. Migrations (`AddRootActivityType`, `AddRootSessionLink`) already exist; no new migration required.

## Non-blocking informational notes (carried from round 1, no action required)

- **Concurrent connects can mint duplicate roots.** `ensureRoot` is concurrency-safe only within a single connect; two overlapping connects for one user can each create a root, the second `setRoot` overwriting the first in the store and orphaning the first row. The spec deliberately defers empty/orphan-root cleanup to the Phase 57 janitor, so this is an acknowledged model limitation, not a defect.
- **Idempotent-branch return is a partial `ModuleSession`** (`as ModuleSession`, omitting `disconnectedAt`/`endedAt`/`metadata`/`createdAt`). Harmless — the only production caller (the controller) ignores the return.

---

REVIEW_PASS
