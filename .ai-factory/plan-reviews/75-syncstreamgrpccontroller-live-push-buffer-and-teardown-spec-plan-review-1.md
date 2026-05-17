# Plan Review: SyncStreamGrpcController — live push, buffer and teardown spec

**Plan File:** `.ai-factory/plans/75-syncstreamgrpccontroller-live-push-buffer-and-teardown-spec.md`
**Target:** `src/realtime/sync-stream.grpc.controller.spec.ts`
**Risk Level:** 🟡 Medium

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)** — N/A for a spec-only task. No module-boundary concerns: the plan adds tests to an existing spec inside `src/realtime/`, no new dependencies, no proto edits, no DB. WARN: not checked because the change is internal to a single spec file.
- **Rules (`.ai-factory/RULES.md`)** — Not present in the repo; skipped.
- **Roadmap (`.ai-factory/ROADMAP.md`)** — The plan declares it closes milestone #75 building on milestone #73. Out-of-scope section explicitly cites #73 tasks 1, 2, 3, 4, 5, 6, 6b, 7 — consistent with what already lives in the spec (auth, live-only short-circuit, replay batches, cursor-too-old, sentinels, empty batches). Alignment: OK.

## Critical Issues

### 🔴 Task 2, Test 5 — incorrect assumption about live-only `isDirect` timing

> "should not emit when pushFn is called before replay has flipped isDirect (live-only edge: synchronous push during construction would buffer)"
>
> "…without awaiting microtasks call `capturedPushFn!([...])`; assert collected emissions still has length 0."

This will fail. In live-only mode (`request.afterId === undefined`), the body of `replay` runs:

```ts
const replay = async (): Promise<void> => {
  if (request.afterId === undefined) {
    isDirect = true;        // ← no await before this
    return;
  }
  ...
  const minEventId = await this.changeLogService.getMinEventId();
```

An async function body executes synchronously **up to the first `await`** (or `return`). The live-only branch has no `await`, so `isDirect = true` is assigned *before* `replay()` returns its Promise. By the time the Observable executor completes and control returns to the test's `subscribe()` call, `isDirect` is already `true`. The captured `pushFn` will go straight through the `if (isDirect) { … subscriber.next(...) }` branch.

Result of the proposed test: `emitted.length === 1` synchronously after the `capturedPushFn!(...)` call, not `0`. The test as written cannot pass against the current controller.

To genuinely test the "buffer path is still reachable in live-only mode," you would need to flip `isDirect = true` *after* an `await` — which the current implementation deliberately does not do. Either:

1. **Drop this test case.** The buffer is unreachable in live-only mode given the current implementation, so there is nothing to assert.
2. **Re-purpose it** to lock in the *current* synchronous behavior: "should emit synchronously without awaiting microtasks because live-only mode flips `isDirect` synchronously" — push immediately after subscribe, expect length 1, with no `flushMicrotasks` call. This pins the synchronous flip as part of the controller's contract and catches a regression that would put an `await` before line 77.

The plan's stated regression-catching rationale ("If the controller short-circuits and never executes the flush block in live-only mode in a future refactor, this test will catch the regression") is also off: the flush block at lines 118–127 is *unreachable* in live-only mode because line 78 `return`s before reaching it. There is no flush in live-only mode to regression-test.

## Notable Issues

### 🟡 Task 6, Test 1 — upper-bound claim worth tightening

> "Assert `changeLogService.getChanges` was called **at most twice**…"

The reasoning is sound: iter 1 issues call #1, iter 2 issues call #2 (resolution synchronously calls `sub.unsubscribe()` via `mockImplementationOnce`), iter 3 short-circuits at `if (subscriber.closed) return;`. So the exact count is 2, not "at most 2". `toHaveBeenCalledTimes(2)` would be a stronger assertion than `toBeLessThanOrEqual(2)` and is supported by the code as written. Either is acceptable, but matching the precision elsewhere in the plan (e.g. Task 5 Test 4's "exactly twice") is preferable.

Also, the closing parenthetical "the loop's `if (subscriber.closed) return` short-circuits before issuing call #3" implicitly assumes call #2's `subscriber.next(...)` is a no-op once the subscriber is closed. That is RxJS behavior, but Task 6 Test 2's "emitted ≤ 2" bound depends on it — worth noting Test 2's expected length is 1 (only iter 1 emitted before unsubscribe; iter 2's `subscriber.next` no-ops). `expect(emitted).toHaveLength(1)` would be tighter and still correct.

### 🟡 Task 6, Test 1 — `mockImplementationOnce` ordering caveat

The plan stages four `mockResolvedValueOnce` returns and then says "Make the **second** `getChanges` resolution synchronously call `sub.unsubscribe()` from within `mockImplementationOnce`." Mixing `mockResolvedValueOnce` and `mockImplementationOnce` requires care — they share the same queue and consume in the order they were declared. The cleanest approach: declare all four mocks with `mockImplementationOnce(() => { … })`, and have the second one call `subRef!.unsubscribe()` before returning the resolved value. The plan describes this correctly in intent but does not spell out the queue-ordering requirement; the implementer should know to interleave them, not append.

### 🟡 Task 5, Test 1 — `Subscriber` import

The assertion uses `expect.any(Subscriber)`. The existing spec already imports `Subscriber` from `rxjs` at line 3 (used by the existing "should register the subscriber with activeStreamRegistry unconditionally" test). Good — no new import needed. Calling this out only to confirm the plan's pattern is consistent.

### 🟡 `flushMicrotasks(10)` — `times` default

Task 6 calls `flushMicrotasks(10)`. The helper at line 47 accepts a `times` arg and the existing spec uses `5`. 10 is harmless overkill; acceptable.

## Sanity-checked correct claims

- Task 1 ordering (`activeStreamRegistry.register` → `syncStreamService.register` → `changeLogService.getMinEventId` / `getChanges`) matches the controller (lines 43, 72, 83, 100). The `await` on line 83 establishes the synchronous boundary the plan relies on.
- Task 3's filter boundary (`id > lastReplayedCursor`, strict `>`) matches line 120 of the controller. Boundary-straddle dedup expectations (ids `95, 100` excluded; `101, 105` included for `cursor=100`) are correct.
- Task 4's direct-mode filter (`stamped.filter((e) => e.id > lastReplayedCursor)`) and the `if (fresh.length > 0)` short-circuit guard match lines 63–64.
- Task 5 Test 4's "twice" count on the cursor-too-old path is correct: line 87 explicit `deregister(userId, pushFn)`, then `subscriber.error` closes the subscriber and fires the `subscriber.add(...)` teardown (lines 132–135), which calls `deregister` again with the same args. Idempotent by `SyncStreamService` contract.
- Task 5 Test 6's "exactly once" for `activeStreamRegistry.deregister` on cursor-too-old is correct: the pre-error path (line 87) only touches `syncStreamService.deregister`; only the teardown invokes `activeStreamRegistry.deregister`.
- `createdAt` stamping with `new Date().toISOString()` (line 58) — the plan correctly notes that exact-value matching is brittle and prescribes regex matching. Good.
- The "raw event (no `createdAt`)" shape passed to `pushFn` is accurate against line 53's type.

## Positive Notes

- Clear delineation of out-of-scope items, anchored to specific #73 task IDs — avoids the easy mistake of re-asserting what the previous milestone already covers.
- The "pushFn capture pattern" preamble (lines 28–39) is well-placed: gives the implementer one reusable snippet rather than repeating it inline in every task.
- Boundary cases on the dedup filter (Task 3 cases 2 & 4, Task 4 cases 1 & 2) are exhaustive — covers strict-greater-than semantics, all-filtered short-circuit, and post-flush drain.
- Task 6 Test 3 (teardown runs even on mid-replay unsubscribe) is the kind of cross-cutting check that catches refactors that move the `subscriber.add(...)` registration inside a conditional.
- Explicit reuse of existing helpers (`makeUser`, `makeDbEvent`, etc.) and the existing top-level `describe` block — no duplication.

## Recommendation

Address Task 2 Test 5 (drop or re-purpose) and the implementer is in good shape. The remaining items are clarifications, not blockers.
