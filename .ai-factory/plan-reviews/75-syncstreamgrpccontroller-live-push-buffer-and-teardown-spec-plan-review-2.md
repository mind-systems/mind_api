# Plan Review: SyncStreamGrpcController — live push, buffer and teardown spec (review 2)

**Plan File:** `.ai-factory/plans/75-syncstreamgrpccontroller-live-push-buffer-and-teardown-spec.md`
**Target:** `src/realtime/sync-stream.grpc.controller.spec.ts`
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)** — N/A for a spec-only task. No new dependencies, no proto edits, no DB. The plan stays inside `src/realtime/` and only edits an existing spec file. OK.
- **Rules (`.ai-factory/RULES.md`)** — Present. Project bans the non-null assertion operator (`!`). The plan's recommended pattern uses `capturedPushFn!([...])` and `subRef!.unsubscribe()` repeatedly. See Notable Issues below. WARN.
- **Roadmap (`.ai-factory/ROADMAP.md`)** — Plan closes milestone #75 building on #73. Out-of-scope items are anchored to specific #73 task IDs already in the spec (auth, live-only short-circuit, replay batches, cursor-too-old, sentinels, empty batches). Alignment: OK.

## Resolution of prior review findings

All four issues from review-1 are addressed:

1. **Task 2 Test 5 (live-only `isDirect` timing)** — Re-purposed exactly as suggested: now asserts the synchronous flip (length 1 emission, no `flushMicrotasks`). The plan explicitly documents the rationale and adds a `Note: do NOT add a separate buffer-then-flush test in live-only mode` callout, confirming the flush block at lines 118–127 is unreachable in this branch. ✅
2. **Task 6 Test 1 (upper bound → exact)** — Tightened to `expect(changeLogService.getChanges).toHaveBeenCalledTimes(2)` with the exact-count justification spelled out. ✅
3. **Task 6 Test 2 (emitted ≤ 2 → exact)** — Tightened to `expect(emitted).toHaveLength(1)` with the RxJS closed-subscriber no-op rationale documented. ✅
4. **Task 6 `mockImplementationOnce` queue ordering** — Plan now explicitly says: "Stage four `getChanges` resolutions via four chained `mockImplementationOnce(...)` calls (do **not** mix `mockResolvedValueOnce` with `mockImplementationOnce`)" and lays out the per-iteration return shapes. ✅

## Critical Issues

None.

## Notable Issues

### 🟡 Project rule violation — non-null assertion `!` in test code

`.ai-factory/RULES.md` bans the non-null assertion operator throughout the project. The plan's reusable "pushFn capture pattern" (lines 32–37) and Task 6 Test 1 (`subRef!.unsubscribe()`) use `!` to dereference state that may be undefined. The rule is written without a test-code carve-out, and the existing spec (line 315–319) already avoids the operator — it captures `pushFn` without invoking it, so it never needs to unwrap.

Two clean options the implementer can pick:

```ts
// Option 1 — narrow with an explicit guard
if (!capturedPushFn) throw new Error('pushFn was not captured by register mock');
capturedPushFn([{ id: 11, entity: 'e', refId: 'r', action: 'created' }]);
```

```ts
// Option 2 — initialize to a typed no-op so the variable is never undefined
let capturedPushFn: (events: Array<{ id: number; entity: string; refId: string; action: string }>) => void = () => {};
(syncStreamService.register as jest.Mock).mockImplementation((_userId, fn) => {
  capturedPushFn = fn;
});
```

Same applies to `subRef!.unsubscribe()` in Task 6 — either guard with `if (!subRef) throw …` or initialize the holder to a no-op subscription. Worth calling out so the implementer doesn't translate the plan's snippet 1:1 and accidentally land a rules violation.

### 🟡 Task 3 Test 1 — `flushMicrotasks()` default depth

The plan uses `await flushMicrotasks()` (default `times=3`). For the afterId=10 / single-batch case the awaits are: `getMinEventId` (1), `getChanges` (2). Default is sufficient. Just flagging that if the implementer ever stages a multi-batch buffer-flush test, the default must be bumped to 5 (matching the existing Task 4 pattern at line 228).

### 🟡 Task 6 Test 3 — order of `replay()` vs. `subscriber.add(...)` teardown registration

The plan correctly asserts the teardown fires when unsubscribe happens mid-replay. Worth being aware: the controller invokes `replay()` on line 129 **before** registering `subscriber.add(...)` on line 132. However, `replay()` is async and yields at the first `await` (line 83), so the synchronous tail of the Observable executor — including `subscriber.add(...)` — has already run by the time iter 2's mock body fires `subRef.unsubscribe()`. So the test as specified will pass, but the implementer should not be surprised that `replay()` is kicked off before the teardown is wired — it's the first `await` boundary that makes the ordering safe.

## Sanity-checked correct claims

- Task 1: register-before-replay ordering against lines 43, 72, 83, 100 — correct. The first `await` at line 83 establishes the synchronous boundary.
- Task 2 Test 5 (synchronous `isDirect` flip): live-only branch (lines 75–78) has no `await` before `isDirect = true; return;`, so async function body executes synchronously. Push immediately after subscribe is in direct mode — emits length 1. ✅
- Task 3 boundary filter (strict `>` against `lastReplayedCursor` on line 120; `if (pending.length > 0)` guard on line 121; `splice(0)` drains the array) — all match the controller.
- Task 4 direct-mode boundary filter at line 63 + `if (fresh.length > 0)` short-circuit at line 64 — all match.
- Task 5 Test 4 "exactly twice" on cursor-too-old: line 87 explicit `deregister(userId, pushFn)`, then `subscriber.error` → `subscriber.add(...)` teardown → second `deregister(userId, pushFn)` call. Asymmetry vs. `activeStreamRegistry.deregister` (Test 6's "exactly once") is correctly identified: pre-error path only touches `syncStreamService.deregister`.
- Task 6 Test 1 trace: iter 1 issues getChanges call #1; iter 2 enters the await, mock body synchronously unsubscribes and resolves; control returns, `subscriber.next` no-ops; iter 3 short-circuits at `if (subscriber.closed) return;`. Exact count = 2. ✅
- `createdAt` regex matching (`/^\d{4}-\d{2}-\d{2}T/`) is the right call against `new Date().toISOString()` at line 58 — exact-value matching would be brittle.
- Raw event shape passed to `pushFn` (no `createdAt`) matches the type at line 53.
- `Subscriber` from `rxjs` is already imported (line 3 of the spec) — no new import required for Task 5 Test 1.

## Positive Notes

- Clean addressing of every review-1 finding with deliberate rationale rather than rote edits — Task 2 Test 5 now both fixes the failing assertion *and* pins the synchronous-flip contract as a regression guard.
- The "do NOT add a buffer-then-flush test in live-only mode" note is exactly the kind of structural guidance that prevents a future contributor from re-introducing the broken case.
- Task 5 Test 4's "exactly twice" wording is consistent across the plan now — the asymmetry callout in Test 6 ("exactly once") makes the contract explicit.
- Task 6's per-iteration trace (iter 1 emits → iter 2 await + sync unsubscribe → iter 3 short-circuits) is the level of detail that lets the implementer write the test without re-deriving the timing.
- Out-of-scope section is precise and anchored to specific #73 task IDs — no risk of re-covering tests that already live in the spec.

## Recommendation

Plan is ready to implement. The one rule-compliance nit (no `!` operator in the capture snippet and `subRef`) should be addressed by the implementer at write time but does not block plan approval.

PLAN_REVIEW_PASS
