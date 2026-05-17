# Plan Review: SyncStreamGrpcController — replay phase spec

**Plan file:** `.ai-factory/plans/73-syncstreamgrpccontroller-replay-phase-spec.md`
**Target file:** `src/realtime/sync-stream.grpc.controller.spec.ts`

## Summary

The plan accurately reflects the controller's behavior in scope (auth gate, live-only short-circuit, replay phase with cursor validation, sentinel, multi-batch loop, empty-batch skip). It explicitly declares replay phase only — live push and teardown are out of scope, which is a reasonable scoping choice for a first spec.

Findings below are mostly polish — the plan is implementable as written, but a few correctness and consistency issues should be addressed before code generation.

## Context Gates

- **ARCHITECTURE.md** — OK. Spec lives in the `realtime` module next to the controller, consistent with project convention (mirrors `module-state.grpc.controller.spec.ts`).
- **RULES.md** — OK. No `!` operators or sensitive-data logging implied; `@Payload()` rule is about the production controller (already correct), not the spec.
- **ROADMAP.md** — Not checked against — this is a test-coverage task with no roadmap-feature linkage required.

## Critical Issues

None. The plan does not introduce architectural mistakes or wrong API assumptions.

## Issues / Suggestions

### 1. Microtask draining: `setTimeout(0)` is inconsistent with the sibling spec and brittle for the multi-batch case

Task 2 prescribes `await new Promise(r => setTimeout(r, 0))`. The neighboring `module-state.grpc.controller.spec.ts` already defines:

```ts
async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
```

Two concerns:
- **Consistency.** Use the same helper in this spec — copy it into the file (or extract to a shared test helper). Mixing `setTimeout(0)` and `flushMicrotasks` in sibling specs makes the codebase harder to scan.
- **Multi-batch sufficiency.** Replay awaits `getMinEventId` → then awaits `getChanges` in a `while` loop. For Task 4 (two batches) and Task 7's second case, you must let *two* awaits resolve before assertions. A single `setTimeout(0)` tick will drain queued microtasks in Node, but for clarity and safety prefer `await flushMicrotasks(5)` (or similar) in the multi-batch tests. Recommend stating the helper explicitly in each task that needs it.

### 2. Task 3 / Task 4 cursor assumption is wrong for the first call

Task 3 says: *"should call changeLogService.getChanges once with (userId, afterId, 100)"* and Task 4 says: *"first call resolves `{ events: [...], cursor: 50, hasMore: true }`, second resolves `{ events: [...], cursor: 75, hasMore: false }`"*.

Looking at the controller (lines 81, 100, 113):

```ts
let cursor = Number(request.afterId);          // initial cursor
...
const result = await this.changeLogService.getChanges(userId, cursor, 100);
...
cursor = result.cursor;
```

So the first `getChanges` call receives `Number(request.afterId)`, not `request.afterId` itself. `WatchChangesRequest.afterId` is typed `number | undefined` in the generated proto (`proto/generated/sync.ts:68`), so `Number(...)` is a no-op for normal numeric input — but the test should be explicit that the spec verifies the integer value, not the original boxed type. Mention `Number(request.afterId)` (or equivalently the literal numeric value) in the expectation to avoid a confusing test if the proto type ever changes (e.g. to `bigint`/string for int64). Low risk, but cheap to be precise.

### 3. Task 5 — pushFn-capture-and-deregister test is correct but under-specified

Task 5 says: *"capture the `pushFn` reference from `syncStreamService.register`, assert `syncStreamService.deregister` was called with `(userId, capturedPushFn)`"*. This is right, but the plan does not describe **how** to capture it. Suggest spelling out the helper, e.g.:

```ts
let capturedPushFn: ((events: any[]) => void) | undefined;
syncStreamService.register = jest.fn((_userId, fn) => { capturedPushFn = fn; });
```

…and likewise for the call-order test (`deregister` before subscriber `error`). The module-state spec already uses this pattern (`capturedSubscriber` at line 204) — mirror it.

Also note: the controller's teardown (`subscriber.add(() => { ...deregister(userId, pushFn); })`) will fire when `subscriber.error()` runs, so `deregister` is actually called **twice** in the cursor-too-old path (once explicitly before `subscriber.error`, once on teardown — the comment on line 86 acknowledges this idempotency). The plan asserts ordering of the **first** explicit call vs. `error`, which is fine, but a test using `toHaveBeenCalledTimes(1)` for `deregister` would fail. Recommend the plan call out `toHaveBeenCalledWith(...)` (not `toHaveBeenCalledTimes(1)`) for `deregister` in this task to prevent a false-failing test.

### 4. Task 6 — missing the `minEventId === null` branch (empty changelog)

The controller's guard is `if (minEventId !== null && cursor !== 0 && cursor < minEventId)`. The plan covers the `cursor === 0` sentinel bypass but does not cover the **`minEventId === null`** bypass (which happens when the changelog table is empty — a real scenario right after fresh install or after `purge` clears everything). A short test like:

> *"should proceed to call getChanges when minEventId is null even if afterId > 0"* — `getMinEventId` resolves `null`, `afterId=50`; assert `getChanges` was called with `(userId, 50, 100)` and no error emitted.

…would close that gap. Worth adding as a Task 6b or extending Task 6.

### 5. Task 2 — implicit assumption that `register` happens synchronously

Task 2 asserts `syncStreamService.register` is called when `afterId === undefined`. Controller code:

```ts
this.syncStreamService.register(userId, pushFn);    // synchronous, line 72
const replay = async (): Promise<void> => { ... };
replay().catch(...);                                // async dispatch, line 129
```

`register` is called synchronously *before* `replay()` runs, **regardless of `afterId`**. So Task 2's assertion is correct, but the plan implies `register` is conditional on the live-only branch — it isn't. Recommend rewording: *"…the live push listener is registered via `syncStreamService.register` (note: this happens unconditionally in `watchChanges`, not specifically because `afterId` is undefined)."* This prevents the implementer from writing a misleading test name like *"only registers when afterId is undefined"*.

### 6. Task 3 / Task 4 — emission shape should verify the wrapper, not just the inner events

The controller emits `subscriber.next({ events: [...] })` — a `ChangeEvent` wrapper containing the array. Task 3's last two cases assert fields on "the emitted event". Recommend rewording the expectations to explicitly check `emitted.events[0].id`, `emitted.events[0].createdAt`, etc., to avoid ambiguity between the `ChangeEvent` wrapper and the inner `SyncEventDto`.

### 7. Out-of-scope items worth listing in the plan's Context

The plan correctly scopes to auth + live-only short-circuit + replay phase. A short explicit "out of scope" list at the top would prevent future reviewers (and the implementer) from re-litigating coverage:

- live-buffer flush after replay (`liveBuffer.splice(0)`)
- `isDirect=true` transition behavior after replay
- pushFn dedup filter (`fresh = stamped.filter(e => e.id > lastReplayedCursor)`)
- `subscriber.closed` short-circuit inside the while loop (line 99)
- `replay().catch((err) => subscriber.error(err))` propagation when `getChanges` rejects
- `subscriber.add(...)` teardown path

This is documentation hygiene, not a correctness issue.

## Positive Notes

- Task decomposition matches the controller's actual control-flow branches one-to-one.
- The cursor-too-old sentinel handling (Task 5 + 6) is split cleanly along the two short-circuit conditions in the production guard.
- Task 5's call-order assertion (`deregister` before `error`) captures real production semantics — that the listener leak doesn't survive the error path — rather than just asserting outputs.
- Task 7's mixed empty/non-empty sequence catches the most likely regression (someone removing the `events.length > 0` guard) without overspecifying the protocol.
- The plan correctly uses the existing `flushMicrotasks`-style pattern in spirit (even if the helper name differs — see issue #1).

---

The plan is solid in substance. Address issues 1–6 (especially #2, #3, #4) before generating the spec to avoid rework.
