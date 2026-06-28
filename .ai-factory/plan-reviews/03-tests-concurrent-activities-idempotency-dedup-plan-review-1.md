# Plan Review: Tests — concurrent activities + idempotency dedup

**Plan:** `.ai-factory/plans/03-tests-concurrent-activities-idempotency-dedup.md`
**Target:** test-only milestone (no feature implementation, no migration)
**Risk Level:** 🟢 Low — solid, adversarially-reasoned plan; verified against the codebase

## Verification performed

Every concrete assumption in the plan was checked against the actual source:

| Plan claim | Verified against | Result |
|---|---|---|
| Constructor `new ModuleStateGrpcController(activityEngine, rateLimiterService, activeStreamRegistry, configService, eventEmitter)` | `module-state.grpc.controller.ts:70-85` | ✅ exact order |
| Singleton guard at `module-state.grpc.controller.ts:281-290` | controller L281-290 (`existing → echo → return`) | ✅ exact lines |
| Anti-target guard tests at `module-state.grpc.controller.spec.ts:652-675` | spec L652 + L665 (the two singleton tests) | ✅ exact lines |
| `'AMBIGUOUS_SESSION'` not yet in `constants/ws-error-codes.ts` | `WsErrorCode` has 8 keys, none is `AMBIGUOUS_SESSION` | ✅ string-literal approach is correct |
| `WS_IDEMPOTENCY_WINDOW_MS` not yet in `RealtimeConfig` | `realtime-config.ts` — key absent | ✅ string-literal approach is correct |
| `clientTimestampMs` proto type is `number \| undefined` (no `Long`) | `proto/generated/module_state.ts:57,66` | ✅ |
| `clientActivityId` / `session_id` absent from proto commands | grep of generated proto — only `clientTimestampMs` found | ✅ `(cmd as any)` access is required |
| `makeConfigService` returns flat `mockReturnValue(10)` (would collapse the window) | spec L56-60 | ✅ the catch is real |
| Sibling spec, two-category convention, per-describe fake-timer scoping | `services/multi-session-lifecycle.spec.ts:1-19,123-161` | ✅ pattern matches |

The plan's most valuable adversarial catches all hold up:
- The flat config mock **would** collapse a 10 000 ms window to 10 ms — the key-aware mock is the right fix.
- With the default `getActiveSession=undefined` the concurrent-start cases **would** be GREEN today (no RED signal) — wiring `getActiveSession` to report an active session on the 2nd start is the correct way to make the RED genuine.
- `advanceTimersByTime(10_001)` (not `10_000`) correctly avoids an off-by-one false RED under a `> window` expiry.
- The compile-before-feature discipline (`(cmd as any)`, `(engine as any)`, string literals for the new error code and config key) is sound and matches how the controller already emits error codes as plain literals.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** `WARN`→none. The new spec is a controller-level unit test placed next to the controller it exercises; no module-boundary or dependency-direction concerns. Aligned.
- **Rules (`.ai-factory/RULES.md`):** `WARN`. RULES.md forbids the non-null assertion operator (`!`). The sibling/existing controller spec mixes `!` (e.g. `values[0].sessionState!` at spec L757/L770/L819/L872) with optional chaining. Recommend the new file consistently use optional chaining (`values[i]?.sessionState?.moduleSessionId`) as the plan's Task 2 already implies, to stay rule-clean. Non-blocking (test code, established convention).
- **Roadmap (`.ai-factory/ROADMAP.md`):** `WARN`→none. The task maps directly to the unchecked roadmap line *"Tests: concurrent activities + idempotency dedup"*. Note the roadmap cites the spec as `.ai-factory/notes/17-test-concurrency-idempotency.md` while this plan lives at `plans/03-…md`; that is the expected notes-vs-plans split, not a defect.

## Findings

### Recommendation 1 (Medium) — Anti-target inventory is incomplete

The plan's anti-target subsection flags only the two singleton-guard tests at `module-state.grpc.controller.spec.ts:652-675`. But threading `sessionId` as the second positional argument (the forward-coupling contract) will **also** break the existing **routing characterization tests** in that same file:

- `endActivity('user-1', undefined)` — spec L783
- `stopActivity('user-1')` — spec L832
- `pauseActivity('user-1')` — spec L888
- `unpauseActivity('user-1')` — spec L954

Once the engine signatures gain `sessionId`, these `toHaveBeenCalledWith` assertions (which pin the *current* `userId`-only / `userId,timestamp` shapes) go RED. A downstream implementer following the *"characterization RED → escalate"* rule could misclassify these as regressions — exactly the confusion the anti-target note exists to prevent.

Suggested fix: extend the anti-target list to name these four tests (and note they belong to the signature change, which materializes when callers are updated), so the inventory is complete.

### Recommendation 2 (Minor) — Cross-spec attribution of the signature change

The forward-coupling section attributes the `userId → (userId, sessionId, …)` engine-signature change to spec 06. Per ROADMAP, the engine signatures and **controller caller updates** actually land in Phase 55 / spec 03 (`multi-session-store-engine`: *"thread explicit sessionId through end/stop/pause/unpause… update callers (module-state.grpc.controller.ts…)"*); spec 06 only adds the **addressed routing** (`cmd.session_id` → named child, sole-child fallback, `AMBIGUOUS_SESSION`). This does **not** change any test in this plan — Task 5's multi-child *routing-to-the-addressed-child* is genuinely RED-until-06 (spec 03 resolves only the single active child). It's purely a documentation-accuracy point: the 2nd-positional-`sessionId` *contract* is owned by spec 03; the *routing semantics* by spec 06. Worth a one-line clarification so specs 03/06 don't both assume sole ownership.

### Recommendation 3 (Minor) — File placement note

Task 1 says it "mirrors how the sibling task created `src/realtime/services/multi-session-lifecycle.spec.ts`" but places the new file at `src/realtime/concurrency-idempotency.spec.ts` (realtime root). The root placement is actually **correct** here — it sits next to `module-state.grpc.controller.ts` / `.spec.ts`, which it exercises (the sibling lives in `services/` because it tests the engine). No change needed; just don't let the "mirror" wording push the file into `services/`. Jest auto-discovers `*.spec.ts`, so no config change is required.

### Note — helpers are copied, not imported

`makeActivityState` is a nested helper inside the existing spec's command-routing `describe` (L609) and `makeSession` (`{ id }`) is top-level (L24); neither is exported. The plan correctly treats these as a *pattern to reuse* (re-authored in the new file). Confirm the harness defines a `{ id }`-shaped builder for `startActivity` returns (controller reads `session.id` at L313) distinct from the `{ sessionId, isPaused }`-shaped `makeActivityState` used for `getActiveSession`/pause/unpause returns.

## Positive Notes

- Excellent red-for-the-right-reason engineering: each TARGET case is shown to be RED **today** for the intended reason and GREEN **after** the feature, with the trap conditions (default mocks producing false GREEN) explicitly neutralized.
- Correct, line-accurate references to controller and spec internals; constructor arg order, guard location, and anti-target lines all verified exact.
- Proto reality respected — new fields/methods/codes accessed via `as any` / string literals so the file compiles cleanly before specs 05/06, giving per-case RED instead of a whole-file red compile.
- TARGET vs CHARACTERIZATION classification is disciplined and matches the established sibling-spec convention; the escalate-don't-patch contract is preserved.
- Per-`describe` fake-timer scoping (not global) correctly avoids interfering with the promise-based `setup()` flow, and the `flushMicrotasks`-under-fake-timers assumption is valid.

## Verdict

The plan is solid and implementable as written; the deliverable (the test file) will be correct and RED-for-the-right-reasons. The findings above are advisory improvements to the forward-coupling documentation and rule-cleanliness, not defects in the test construction.

PLAN_REVIEW_PASS
