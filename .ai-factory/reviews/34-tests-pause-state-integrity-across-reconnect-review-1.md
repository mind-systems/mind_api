# Code Review — Tests: pause-state integrity across reconnect (review 1)

**Scope:** `git diff HEAD` — two modified spec files (test-only milestone). No production code, no migrations, no proto changes.

- `src/realtime/services/activity-engine.service.spec.ts` (+137)
- `src/realtime/module-state.grpc.controller.spec.ts` (+42)

(The three `.ai-factory/*` plan/review artifacts are documentation, not code — not reviewed for runtime correctness.)

## Verification performed

Ran both suites:

```
npx jest src/realtime/services/activity-engine.service.spec.ts src/realtime/module-state.grpc.controller.spec.ts
Tests: 6 failed, 106 passed, 112 total
```

Cross-checked every failure against the surrounding source (`activity-engine.service.ts`, `module-state.grpc.controller.ts`, `activity-session-store.service.ts`, `ws-error-codes.ts`) read in full.

### The 6 RED tests break down cleanly

**3 are this milestone's intended targets, each failing for the documented reason:**

1. `pause integrity across resume … › Case A — resume preserves pause` — `resumeActivity` unconditionally runs `state.isPaused = false` (`activity-engine.service.ts:622`). The seeded child is the same object reference held in the store map, so the mutation is observed via `getSession(...)?.isPaused === false` → assertion of `true` fails. Removing the reset (note 24) flips it GREEN. Vantage observes both states. ✓
2. `… › Case B — unpause succeeds after resume` — after the buggy reset leaves `isPaused=false`, `unpauseActivity` hits the `!state.isPaused` guard → throws `NOT_PAUSED` (`:549-550`), so `.not.toThrow()` fails. `unpauseActivity` is synchronous, so the `expect(() => …).not.toThrow()` form is correct (no floating promise). ✓
3. `(b) RED until spec 24 … isPaused true when getSession returns a paused session` — controller hardcodes `isPaused: false` (`module-state.grpc.controller.ts:173`); confirmed emitted `isPaused: false` vs expected `true`. Note 24's pinned fix `getSession(userId, result.id)?.isPaused ?? false` with the mocked `{ isPaused: true }` flips it GREEN. ✓

**3 are pre-existing, NOT introduced by this diff** — `RED until spec 23-connection-loss-markers` (disconnect/reconnect marker + abandon-timestamp). These were committed RED by the prior milestone (`f6da353`, "Tests: connection-loss markers") and live outside this diff's hunks. They are expected and unrelated.

### Correctness checks that passed

- **Store semantics:** `getSession` resolves a child added via `addChild` (`activity-session-store.service.ts:108-113`); `getRootId` returns `null` when no root is seeded (`:79-81`). The new tests seed `rootSessionId: null` and pass an explicit `sessionId`, so the unpause root-guard (`sid === getRootId(userId)` / `activityType === ROOT`) is correctly bypassed — the tests reach the real `NOT_PAUSED`/preserve logic, not an unintended `NO_ACTIVE_SESSION` path. ✓
- **Characterization cases stay GREEN** (all 4 new engine guard cases + the renamed `(a)` resumed-unpaused controller case pass). The `(a)` case keeps its original assertions (`isPaused: false`, `toHaveLength(1)`); only its title/comment changed — no silent weakening. ✓
- **`getSession` mock added correctly** to `makeActivityEngine()` with default `mockReturnValue(undefined)`. This is load-bearing: once note 24 makes the controller call `activityEngine.getSession(...)`, the absence of the mock would throw `TypeError`. Default `undefined → ?? false` keeps all pre-note-24 reconnect cases green. ✓
- **`WsErrorCode` import** resolves (`../constants/ws-error-codes` exports `ALREADY_PAUSED: 'already_paused'`, `NOT_PAUSED: 'not_paused'`); `toThrow(WsErrorCode.X)` substring-matches the `new Error(WsErrorCode.X)` messages. ✓
- **No timer leaks:** the new describe blocks sit outside the fake-timer `connection-loss` block and exercise only `pauseActivity`/`unpauseActivity`/`resumeActivity`, none of which arm grace timers. ✓
- **Frame count after note 24:** the `(b)` test asserts `toHaveLength(1)`; note 24 changes only the `isPaused` value in the existing single RESUMED emission, not the frame count, so the assertion remains valid post-fix. ✓
- **No production code touched**, so no other suite can regress from these edits; both target suites compiled and ran.

## Non-blocking observations (no action required)

- The combined realtime suite now carries **6 committed-RED tests** (3 spec-23 + 3 spec-24). This is intrinsic to the silent-bug-first TDD workflow on this branch — a fresh `jest` run will show failures that are *expected*, not regressions. Anyone wiring a CI gate before notes 23/24 land should scope green-ness to the characterization cases, not the whole file.
- Case B asserts only `.not.toThrow()` rather than the post-unpause state. This is exactly what spec note 28 prescribes ("a subsequent `unpauseActivity` does not throw `NOT_PAUSED`"), so it is correct as written — noted only for completeness.

## Conclusion

The diff is a clean, correctly-designed TDD test commit. Every target fails for its documented reason with a vantage that observes both the RED-now and GREEN-after states; characterization holds; the `getSession` mock and `WsErrorCode` import are in place; no production code, migrations, or contracts are affected. No bugs, security issues, or correctness problems found.

REVIEW_PASS
