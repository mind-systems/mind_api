# Code Review (round 2): Corrective tests — root-as-activity-type (module-state)

**Change under review:** `src/realtime/module-state.grpc.controller.spec.ts` (test-only)
**Reviewed against:** controller source (`module-state.grpc.controller.ts`), generated stub (`proto/generated/module_state.ts`), plan, notes 34/37, and review-1.
**Scope:** No production / proto / migration changes. Only the spec file is modified; the other staged files are plan/review docs.

## Round-1 findings — all resolved

1. **(was Medium) "routes through ensureRoot, not startActivity" was GREEN today — FIXED.**
   `:401` now calls `activityEngine.ensureRoot.mockClear()` after the connect `flushMicrotasks()`, dropping the unconditional connect-time `ensureRoot` call (controller `:154`) so only the command's effect is observed. Verified two-state:
   - **RED today:** the ROOT command throws in `mapProtoActivityType` (`:360-361`) before any per-command `ensureRoot` call, so post-clear `expect(ensureRoot).toHaveBeenCalled()` is `false` → fails.
   - **GREEN after a1:** ROOT routes to `ensureRoot` → called → passes.
   `mockClear()` clears only call/result records and preserves the `mockResolvedValue('root-1')` set at `:391`, so engine setup still resolves correctly. Correct fix.

2. **(was Low/nit) Misleading CANNOT_END_ROOT comments — FIXED.**
   `:482-484` and `:511-513` now accurately state that today `endActivity`/`stopActivity` are called but return `null` (no frame, len 0), and the test is RED via both `toHaveLength(1)` and `not.toHaveBeenCalled()`. Matches the controller's `if (!session) return;` short-circuit (`:411`, `:436`).

3. **(was Low/nit) Idempotent test hardening — FIXED.**
   `:435` adds `expect(values).toHaveLength(2)`. Combined with the `moduleSessionId === 'root-1'` assertions this stays RED today (both frames are `sessionError`, so `.sessionState` is `undefined`) and GREEN after a1.

## Independent re-verification of all new targets

- **ROOT start → ACTIVE + `activityType === 3`** (`:363-388`): RED today (`mapProtoActivityType` throws → `sessionError`, so `moduleSessionId`/`status`/`activityType` assertions fail), GREEN after a1. `3 as ActivityType` hits the enum `default` arm (enum stops at `MEDITATION = 2`); `(... as any).activityType` reads `undefined` today since `StateEvent` has no such field yet. Cast is required and correct (ts-proto camelCases `activity_type → activityType`, confirmed in the stub).
- **Idempotent** (`:414-440`): RED/GREEN as above.
- **Child BREATH `activityType !== 3`** (`:442-462`): permanently GREEN negative guard (acknowledged in plan-review-1); the positive ROOT test carries the a1-landing signal. Acceptable.
- **CANNOT_END_ROOT on end / stop** (`:464-520`): RED today (len 0 ≠ 1; `endActivity`/`stopActivity` are called), GREEN after a1. `getRootId` (not `getSession`) is mocked — matches a1's actual delegate per note 34.

## Characterization (stays GREEN) — confirmed against controller

- Reverted `(a)` RESUMED → `[RESUMED]` len 1, `(b)` ABANDONED → `[ABANDONED]` len 1, fresh-connect / `(c)` → len 0, `(d)` → `[ABANDONED, ACTIVE(new-session)]` len 2 all match `setup()` emission logic (`:128-149`) and `startActivity` routing.
- `getRootId: jest.fn()` (default `undefined`) added to the engine mock has no effect on any GREEN test — the controller never calls `getRootId` pre-a1.
- Refreshed `setupRoutingStream` drain comment is accurate (no connect frame on the default `null` path → `values.length = 0` is a no-op).

## Verdict

All round-1 findings are resolved, the suite compiles, every new target is genuinely RED-now / GREEN-after-a1, and the reverted characterization cases match current controller behavior. No remaining issues.

REVIEW_PASS
