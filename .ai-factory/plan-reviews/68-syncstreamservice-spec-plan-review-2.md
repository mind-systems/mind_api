# Plan Review: SyncStreamService spec (68) — round 2

**Plan file:** `.ai-factory/plans/68-syncstreamservice-spec.md`
**Target:** `src/realtime/services/sync-stream.service.spec.ts`
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** OK. The spec sits next to the service inside the realtime module, matching the modular-monolith convention and existing siblings (`active-stream-registry.service.spec.ts`, `rate-limiter.service.spec.ts`, `stream-engine.service.spec.ts`).
- **Rules (`.ai-factory/RULES.md`):** OK. Project rules concern production code (no `!`, no PII in logs, `@Payload()` on gRPC). None apply to a Jest spec file. No use of non-null assertions or sensitive-data logging is implied.
- **Roadmap (`.ai-factory/ROADMAP.md`):** OK — test/spec milestone, linkage requirement does not apply.
- **Skill-context (`.ai-factory/skill-context/aif-review/SKILL.md`):** not present — no project overrides apply.

## Cross-check against the implementation

Implementation re-read: `src/realtime/services/sync-stream.service.ts`. Payload type re-confirmed: `src/changelog/changelog.events.ts` — `{ id: number; entity: ChangeEntity; refId: string; action: ChangeAction; userId: string }`.

- Phase 1 (`register`): Correctly covers entry creation, second-callback append, Set dedup, and per-userId isolation. ✅
- Phase 2 (`deregister`): Covers unknown user, unknown callback, partial removal, last-callback deletion, pending-timer clearance, cross-user isolation. ✅
- Phase 3 (`onChangeLogged` debounce): Unregistered-user no-op, first-event timer creation, append-while-pending, no second timer, single flush, `userId`-stripped `LiveEvent` shape with the explicit `toHaveBeenCalledWith([{ id, entity, refId, action }])` assertion, FIFO ordering, post-flush re-arm. ✅
- Phase 4 (fan-out): All registered callbacks invoked, identical array reference (this matches `for (const push of entry.callbacks) { push(events); }` in `flush()`), cross-user isolation, deregistered callback not invoked. ✅
- Phase 5 (`for...of` error propagation): Short-circuit at first throw, fake-timer-synchronous `expect(() => jest.advanceTimersByTime(300)).toThrow(...)` framing, and the recovery-after-throw case anchored on `entry.pending = null` running before the loop. ✅
- Phase 6 (`onModuleDestroy`): Clears timers, drops registrations (via behavioral oracle, not private-state inspection), empty-registry safety, double-call safety. ✅

The Test Harness section explicitly resolves the three issues raised in review-1:
- Fake timers in `beforeEach` / real timers in `afterEach`, with `advanceTimersByTime(300)` (and async variant noted) — addresses review-1 issue #1.
- Phase 5 second test uses `expect(() => jest.advanceTimersByTime(300)).toThrow(...)` with explicit fake-timer scoping in the test name — addresses review-1 issue #2.
- "No reaching into private state" is now a harness-level rule; Phase 6 explicitly forbids `streams.size` and prescribes a behavioral oracle — addresses review-1 issue #3.
- Recovery-after-throw test was added to Phase 5 — addresses review-1 suggestion #4.
- Field-stripping assertion is now spelled out — addresses review-1 suggestion #5.
- `@OnEvent` wiring assumption is now explicit ("Invoke `onChangeLogged` directly") — addresses review-1 suggestion #6.

## Findings

### Issues to address

None blocking.

### Suggestions (nice-to-have)

1. **Phase 5 — recovery-after-throw setup is implicit.** The third Phase 5 test ("should allow a new pending batch to be created on the same userId after a previous flush threw") will trip on its own throwing callback A on the second flush, because A is still in the Set and is iterated first (Set preserves insertion order). The test author needs to either (a) `deregister` callback A before the second `onChangeLogged`, or (b) replace the throwing callback before re-triggering. The plan's phrase "the new (non-throwing) callback receives the fresh batch" gestures at this but doesn't state it. One added sentence ("Before re-triggering, deregister callback A so the second flush iterates only non-throwing callbacks") would prevent a wasted debug round during implementation.

2. **Enum imports for `entity` / `action`.** `LiveEvent` declares them as `string`, but `ChangeEventPayload` types them as `ChangeEntity` / `ChangeAction` enums. The implementer will need to import the enums from `src/changelog/changelog.enums.ts` (or the `src/changelog` barrel) to build test payloads. Not blocking — the conventions in `changelog.service.spec.ts` already model this — but worth a half-line note in the Test Harness if you want the plan fully self-contained.

3. **Phase 1 dedup test could be reworded behaviorally.** "should deduplicate via Set" leaks an implementation detail. A behavior-first phrasing such as "should invoke a callback only once per fan-out when the same reference was registered twice" makes the test resilient to internal restructuring (e.g., a future swap of `Set` for an array with a manual dedup check). Minor — the current name is still acceptable.

### Positive Notes

- Test Harness section is the right shape: explicit, applies-to-every-phase, and addresses each of round 1's critical points up front rather than per-task.
- The `for...of` short-circuit is correctly framed as **documented current behavior**, not a guarantee — and the recovery test pins the exact line ordering (`entry.pending = null` before the loop) that makes recovery possible. Good defense against silent refactor regressions.
- The "no `(service as any).streams`" guardrail is explicit and matches the spirit of `RULES.md` (behavior-first, fail-loudly-on-real-misuse).
- File path, test command, dependency-free instantiation, and reliance on `EventEmitter2` only at the `AppModule` level all match repo convention.

## Verdict

All round-1 issues are resolved. Remaining items are nice-to-have wording clarifications, not gaps in coverage. Plan is implementation-ready.

PLAN_REVIEW_PASS
