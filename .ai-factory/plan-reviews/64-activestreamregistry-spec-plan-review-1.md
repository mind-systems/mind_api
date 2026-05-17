# Plan Review: ActiveStreamRegistry spec (review 1)

**Plan:** `64-activestreamregistry-spec.md`
**Target:** `src/realtime/services/active-stream-registry.service.spec.ts`
**Risk Level:** 🟢 Low

## Scope Verification

Cross-checked the plan against the actual source at `src/realtime/services/active-stream-registry.service.ts`. Public surface:

- `get size()` ✅ covered (Phase 4, Task 5)
- `register(userId, subscriber)` ✅ covered (Task 2)
- `deregister(userId, subscriber)` ✅ covered (Task 3)
- `closeAll(userId)` ✅ covered (Task 4)
- `onModuleDestroy()` ✅ covered (Task 6)
- Internal `streams` map — exercised indirectly through `size` and behavioral checks; no need to peek at private state ✅

All branches in the implementation are reached:
- `register`: both the "set already exists" and "create new set" branches.
- `deregister`: `set === undefined` (unknown user), removed subscriber leaving non-empty set, removed subscriber leaving empty set (→ map delete).
- `closeAll`: `set === undefined` (unknown user) early return + iteration + map delete.
- `onModuleDestroy`: empty map and populated map (across multiple users).

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** No boundary impact — this is a unit spec colocated with the service it tests, consistent with the project pattern (`rate-limiter.service.spec.ts`, `activity-engine.service.spec.ts`, `startup-recovery.service.spec.ts` all live next to their implementations). ✅
- **Rules (`.ai-factory/RULES.md`):** No `!` operator, no PII logging, no gRPC decorator concerns — none of these touch a unit spec for an in-memory registry. ✅
- **Roadmap (`.ai-factory/ROADMAP.md`):** Not checked for line-item linkage; this looks like ongoing test-coverage work (`ROADMAP_TESTS.md` is present in the project). WARN only if a roadmap entry exists for this service that the plan should reference.

## Strengths

- Phased structure mirrors the public API surface; each phase is independently runnable.
- Edge cases explicitly enumerated: unknown userId, unknown subscriber, idempotent re-registration, "set deleted after last subscriber" behavior, isolation across users.
- The "re-register after onModuleDestroy" case (Task 6, last bullet) correctly probes whether destruction leaves the registry in a usable state — important because `streams.clear()` does not invalidate the registry as a service.
- Uses real `Subscriber` instances rather than mocks. This is appropriate: rxjs `Subscriber` is exported and constructable in rxjs 7.8.1 (the project's pinned version), and `Set` identity behavior depends on real references.
- Idempotency assertion for `register()` (Task 2, fourth bullet) is correct — `Set.add` is a no-op for identical references, so size stays at 1.

## Suggestions (non-blocking)

1. **`jest.spyOn(subscriber, 'complete')` caveat (Task 4 / Task 6).**
   `complete` is on `Subscriber.prototype`. `jest.spyOn(instance, 'complete')` will install an instance-level override that wraps the prototype method — this works in rxjs 7, but note that by default `jest.spyOn` keeps the original implementation, so the subscriber will actually transition to a stopped state after the first call. That's the desired behavior for these tests, but worth being aware of: a single `Subscriber` instance can't be reused across two `complete()` calls and still register a second invocation on the spy (the second call is a no-op internally). The plan's cases never call `complete` twice on the same subscriber, so this is fine — just call out in the spec that a fresh `new Subscriber()` is constructed in each `beforeEach` or per-test.

2. **Constructing `Subscriber` without an Observer.**
   `new Subscriber()` in rxjs 7 emits a deprecation warning in some setups. To keep the spec output clean, either pass a minimal observer (`new Subscriber({ next: () => {}, error: () => {}, complete: () => {} })`) or wrap construction in a small `makeSubscriber()` test helper. Not a correctness issue, just polish.

3. **Task 3 — "no-op for unknown subscriber that was never registered for that userId".**
   Implementation does `set.delete(subscriber)` unconditionally; `Set.delete` returns `false` for unknown members and does not throw. The assertion as written ("size unchanged") is sufficient. Consider also asserting that the *existing* subscriber in the set is still present (e.g. by deregistering it afterwards and watching size drop to 0) so the test catches a hypothetical regression that incorrectly clears the whole set on an unknown-subscriber deregister.

4. **Task 4 — "delete user's Set after closeAll".**
   The plan suggests verifying via "subsequent `closeAll(userId)` is a no-op". A stronger check: after `closeAll(userA)`, calling `register(userA, freshSubscriber)` should produce a *new* Set (size goes 0 → 1, not from leftover state). This mirrors the post-destroy reuse check in Task 6 and catches the case where `closeAll` forgets to delete the map entry but somehow empties the set.

5. **No coverage of concurrent semantics.**
   Not actually a gap — JS is single-threaded and the service has no async surface — but worth a one-line comment in the spec stating that all operations are synchronous, so the spec deliberately runs without fake timers / `await`.

## Missing Steps / Wrong Assumptions

None blocking. The plan accurately reflects the implementation and matches existing spec conventions in `src/realtime/services/` (cf. `rate-limiter.service.spec.ts`, which also instantiates the service directly via `new RateLimiterService()` without a Nest testing module — appropriate for a pure in-memory utility, and the right pattern to follow here).

## Architectural / Security / Migration Concerns

None. This is a pure unit spec for an in-memory map. No DB, no network, no migration, no auth surface.

## File Paths and API Usage

- Target spec path `src/realtime/services/active-stream-registry.service.spec.ts` ✅ matches the colocated-spec convention.
- Test command `npx jest src/realtime/services/active-stream-registry.service.spec.ts` ✅ matches the project's documented "Run a single test file" pattern in `mind_api/CLAUDE.md`.
- `Subscriber` import path `from 'rxjs'` ✅ is the public export in rxjs 7.

PLAN_REVIEW_PASS
