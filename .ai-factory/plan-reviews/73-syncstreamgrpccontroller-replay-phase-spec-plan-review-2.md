# Plan Review 2: SyncStreamGrpcController — replay phase spec

**Plan file:** `.ai-factory/plans/73-syncstreamgrpccontroller-replay-phase-spec.md`
**Target file:** `src/realtime/sync-stream.grpc.controller.spec.ts`
**Previous review:** `.ai-factory/plan-reviews/73-syncstreamgrpccontroller-replay-phase-spec-plan-review-1.md`

## Summary

The plan has been thoroughly revised in response to review-1. All seven prior findings are addressed substantively — not just textually — and the test cases now line up cleanly with the controller's actual control flow. No remaining correctness, architectural, or API-usage issues found.

## Context Gates

- **ARCHITECTURE.md** — OK. Spec lives next to the controller in `src/realtime/`, matching the existing `module-state.grpc.controller.spec.ts` placement convention. Modular monolith boundaries respected (no cross-module repository injection, mocks limited to the controller's three direct collaborators).
- **RULES.md** — OK. The plan describes a unit spec; no `!` operators, no PII logging, no `synchronize=true` migration risk. The `@Payload()`/`@GrpcCurrentUser()` decorator contract in the controller is already correct and the spec exercises it through its public surface.
- **ROADMAP.md** — N/A. Test-coverage task, no roadmap-feature linkage required.

## Verification of prior-review findings

| Review 1 finding | Status in current plan |
|---|---|
| #1 Use `flushMicrotasks` helper, drop `setTimeout(0)` | ✅ Shared-helper section (lines 25–35) inlines the exact helper used in the sibling spec; `flushMicrotasks(5)` explicitly called out for multi-batch tests (Task 4, Task 7 case 2). |
| #2 Make `Number(request.afterId)` explicit, use numeric literal in expectations | ✅ Tasks 3 and 4 both call out the `Number(...)` wrap and prescribe asserting on the explicit numeric value (e.g. `42`, `50`). Rationale (future proto type change to bigint/string) recorded in the plan. |
| #3 pushFn capture pattern + `toHaveBeenCalledWith` not `toHaveBeenCalledTimes(1)` | ✅ Dedicated "pushFn capture pattern" section (lines 37–48) with code snippet, and Task 5 explicitly warns against `toHaveBeenCalledTimes(1)` because of the idempotent teardown deregister. |
| #4 Missing `minEventId === null` bypass | ✅ New Task 6b covers both the no-error assertion and the `getChanges` cursor-passthrough assertion. |
| #5 Clarify that `register` is unconditional | ✅ Task 2 third/fourth bullets explicitly state register runs unconditionally at line 72, before `replay()` is dispatched. |
| #6 Verify emission wrapper shape (not inner event) | ✅ Tasks 3, 4, 6, and 7 all reference `emitted[0].events[0].id` etc., disambiguating the `ChangeEvent` wrapper from the inner `SyncEventDto`. |
| #7 Explicit out-of-scope list | ✅ "Out of scope" subsection (lines 6–12) enumerates all six deferred behaviors. |

## Cross-checks against the source

- **Controller line 84 guard** (`minEventId !== null && cursor !== 0 && cursor < minEventId`) — Task 5 covers the failure path, Task 6 covers the `cursor === 0` bypass, Task 6b covers the `minEventId === null` bypass. All three branches of the conjunction are exercised.
- **Controller line 100** (`getChanges(userId, cursor, 100)`) — Task 3 and Task 4 both assert the literal `100` limit; matches the production hard-coded value.
- **Controller lines 102–112** (empty-batch skip + wrapper emit shape `{ events: [...] }`) — Task 7 covers both empty-only and mixed empty/non-empty sequences; emission shape consistently asserted as `{ events: [...] }`.
- **Controller line 113–115** (cursor + hasMore propagation between iterations) — Task 4 asserts second call receives `cursor=50` (first batch's returned cursor), and that no third call follows `hasMore: false`. Loop-termination invariant covered.
- **Controller line 87** (explicit `deregister` before `subscriber.error`) — Task 5 asserts call ordering via shared call-order array, and correctly anticipates the second deregister fired from the teardown handler at line 134. The plan's note about `toHaveBeenCalledWith` instead of `toHaveBeenCalledTimes(1)` is exactly right — the teardown handler `subscriber.add(() => this.syncStreamService.deregister(userId, pushFn))` will fire after `subscriber.error()`, making `deregister` mocked-call-count = 2 on this path. A strict count assertion would false-fail.
- **Proto generated `WatchChangesRequest.afterId`** is typed `number | undefined`, so the `afterId === undefined` distinction vs `afterId === 0` (Task 2 vs Task 6) is well-formed at the type level. The proto is `optional int64`, so a literal `0` is distinguishable from absence on the wire — the test setup is valid.
- **Helper reference at module-state spec line 204** — confirmed: `let capturedSubscriber: Subscriber<StateResponse> | undefined;` is at line 204 (followed by the `jest.fn` capture pattern on line 205). The plan's citation is accurate.

## Critical Issues

None.

## Issues / Suggestions

None blocking. Minor optional polish:

- The plan does not explicitly enumerate the mock-factory scaffolding (e.g. `makeChangeLogService()`, `makeSyncStreamService()`) that the implementer will need to write before any test runs. The sibling `module-state.grpc.controller.spec.ts` uses `makeActivityEngine()`, `makeRateLimiterService()`, etc. The implementer can infer this from the sibling spec, so it's not a missing step per se — but a short "Test rig" subsection naming the three mocks (`changeLogService` with `getMinEventId`/`getChanges`; `syncStreamService` with `register`/`deregister`; `activeStreamRegistry` with `register`/`deregister`) would tighten the plan further. Optional.

## Positive Notes

- All seven prior findings addressed with concrete plan text, not hand-waves.
- The two-pronged guard at line 84 is now decomposed into Task 5 (failure), Task 6 (`cursor === 0` bypass), and Task 6b (`minEventId === null` bypass), so every conjunct is exercised independently.
- The pushFn-capture pattern is documented once at the top of the plan and referenced by Task 5, avoiding duplication.
- Out-of-scope list is now thorough enough to deflect re-litigation in a follow-up review.
- Task names consistently use the wrapper-vs-inner terminology (`ChangeEvent wrapper`, `inner event`), removing the ambiguity flagged in review-1.

---

PLAN_REVIEW_PASS
