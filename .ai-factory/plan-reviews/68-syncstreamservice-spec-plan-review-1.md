# Plan Review: SyncStreamService spec (68)

**Plan file:** `.ai-factory/plans/68-syncstreamservice-spec.md`
**Target:** `src/realtime/services/sync-stream.service.spec.ts`
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** OK. Spec file co-located with the service inside the realtime module — matches the modular-monolith convention and the existing pattern next to `active-stream-registry.service.spec.ts`, `stream-engine.service.spec.ts`, etc.
- **Rules (`.ai-factory/RULES.md`):** OK. No explicit test-related rule violations.
- **Roadmap (`.ai-factory/ROADMAP.md`):** OK — this is a test/spec milestone, not feature work, so linkage requirement does not apply.
- **Skill-context (`.ai-factory/skill-context/aif-review/SKILL.md`):** not present — no project overrides apply.

## Plan vs. Implementation Cross-check

Implementation reviewed: `src/realtime/services/sync-stream.service.ts`.

- `register()` — Phase 1 covers entry creation, Set-based dedup, multi-callback, multi-user. ✅
- `deregister()` — Phase 2 covers unknown user, unknown callback, partial removal, last-callback deletion, timer clearance, and cross-user isolation. ✅
- `onChangeLogged()` — Phase 3 correctly covers the unregistered-user no-op, the 300ms timer creation, append-while-pending semantics, no second timer, single flush, the `userId`-stripped `LiveEvent` shape, FIFO ordering, and post-flush re-arming. ✅
- Fan-out — Phase 4 covers fan-out to all callbacks, same array reference, cross-user isolation, and deregistration before flush. ✅
- `for...of` error propagation — Phase 5 documents the current short-circuit behavior. ✅
- `onModuleDestroy()` — Phase 6 covers timer clearance, Map clear, empty-registry safety, double-call safety. ✅

The plan's coverage matrix is well-aligned with the actual control flow of `sync-stream.service.ts`. Imports/types (`PushCallback`, `LiveEvent`, `ChangeEventPayload` from `src/changelog`) are reachable; the service has no constructor dependencies, so direct instantiation in `beforeEach` is sufficient (same pattern as `active-stream-registry.service.spec.ts`).

## Findings

### Issues to address

1. **Fake-timer strategy is not specified.** The 300ms debounce is the central behavior under test. Every other timer-driven spec in this folder (`rate-limiter.service.spec.ts`, `stream-engine.service.spec.ts`) uses `jest.useFakeTimers()` + `jest.advanceTimersByTime(...)` / `jest.advanceTimersByTimeAsync(...)`. The plan should make this explicit, otherwise the implementer may default to real `setTimeout` and produce slow, flaky tests. Recommendation: add a "Test harness" note before Phase 1 stating "Use `jest.useFakeTimers()` in `beforeEach`; advance via `jest.advanceTimersByTime(...)`."

2. **Phase 5 — error propagation semantics need clarification.** A throw inside the `setTimeout` callback in `flush()` does NOT propagate synchronously under real timers (it becomes a Node `uncaughtException`). The test "should propagate the thrown error out of the timer tick (documented behavior)" only works as written when fake timers run the callback synchronously via `jest.advanceTimersByTime` / `runAllTimers`. The plan should either (a) call out that this test relies on fake-timer synchronous execution and assert via `expect(() => jest.advanceTimersByTime(300)).toThrow(...)`, or (b) reword to "the thrown error escapes the timer callback under fake timers" to avoid making a claim that is false under real timers.

3. **Phase 6 — verifying "Map cleared" via private state.** `streams` is `private`, so the proposed test "should empty the internal streams Map so size-equivalent state is fully cleared" cannot directly inspect `streams.size`. The plan should specify the behavioral oracle, e.g.: after `onModuleDestroy()`, calling `onChangeLogged({ userId: 'u1', ... })` for a previously-registered user must be a no-op (callback not invoked even after advancing timers). Without this, the implementer is likely to reach for `(service as any).streams.size`, which is fragile.

### Suggestions (nice-to-have)

4. **Add a recovery-after-throw case to Phase 5.** `flush()` sets `entry.pending = null` *before* iterating callbacks, so even when a callback throws, the next `onChangeLogged` for that user can start a fresh batch. Worth one test: "should allow a new pending batch to be created on the same userId after a previous flush threw". This documents the recovery side of the `for...of` behavior and protects against a future refactor that moves the `pending = null` line below the loop.

5. **Phase 3 field-stripping test wording.** Make explicit that the assertion should be `expect(callback).toHaveBeenCalledWith([{ id, entity, refId, action }])` (no `userId` key), rather than only checking individual fields — this catches accidental spread of the whole payload.

6. **OnEvent wiring is out of scope but worth a sentence.** The plan implicitly calls `service.onChangeLogged(payload)` directly rather than going through `EventEmitter2`. That matches the convention in this codebase (the `@OnEvent` decorator is metadata; integration with `EventEmitter2` is an `AppModule` concern). Stating this assumption explicitly avoids a debate during implementation.

### Positive Notes

- Phase decomposition mirrors the service's public surface cleanly (register → deregister → onChangeLogged → flush → onModuleDestroy).
- Test names are descriptive and behavior-first, matching the project's existing spec style (e.g., `active-stream-registry.service.spec.ts`).
- Fan-out array-reference identity (Phase 4) is a thoughtful catch — easy to regress under refactor.
- The "documented behavior" framing on Phase 5 correctly signals that the `for...of` short-circuit is a pinned current behavior, not a guarantee — appropriate for a service whose error policy may evolve.
- File path and test command match repo conventions exactly.

## Verdict

The plan is structurally sound and the test matrix is comprehensive. The three issues above (fake-timer strategy, error-propagation assertion mechanics under fake timers, and how to assert Map-cleared without touching private state) are clarifications rather than missing coverage, but they should be resolved before implementation to avoid rework.
