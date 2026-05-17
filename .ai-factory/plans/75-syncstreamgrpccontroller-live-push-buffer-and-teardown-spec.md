# Test Plan: SyncStreamGrpcController — live push, buffer and teardown spec

## Context
`SyncStreamGrpcController.watchChanges` registers a live push listener (`pushFn`) with `SyncStreamService` **before** replay starts, so events arriving during replay are buffered into `liveBuffer` and flushed after replay completes (filtered by `id > lastReplayedCursor`). Once replay ends, `isDirect = true` flips and `pushFn` writes directly to the subscriber (still filtering boundary-straddle events that share an id with the last replay batch). The replay milestone (#73) already covers auth, the live-only short-circuit's static collaborator calls, replay batching, cursor-too-old error path, and empty-batch skipping. This milestone closes the remaining gaps: gap-prevention ordering, the `liveBuffer` flush, direct-mode dedup, live-only push delivery, `subscriber.closed` short-circuit inside the replay loop, and the `subscriber.add(...)` teardown (lines 53–70, 99, 118–127, 132–135 of `sync-stream.grpc.controller.ts`).

### Out of scope (covered by previous milestone or unrelated)
- Auth gate — covered by #73 Task 1.
- Live-only short-circuit's non-call of `getMinEventId`/`getChanges` — covered by #73 Task 2.
- Replay batching, cursor argument flow, empty-batch skipping, `afterId=0` and `minEventId === null` sentinels — covered by #73 Tasks 3, 4, 6, 6b, 7.
- The `FAILED_PRECONDITION` emission itself, the pre-error `deregister` call, and that error-path `deregister` uses the captured `pushFn` — covered by #73 Task 5. This plan only adds the **second** call assertion (teardown invocation that follows `subscriber.error`).
- `replay().catch((err) => subscriber.error(err))` propagation when `getChanges` rejects — not requested by milestone.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/realtime/sync-stream.grpc.controller.spec.ts`

## Target Spec File
`src/realtime/sync-stream.grpc.controller.spec.ts`

## Reuse from existing spec

The spec file already defines `makeUser`, `makeDbEvent`, `makeChangeLogService`, `makeSyncStreamService`, `makeActiveStreamRegistry`, and `flushMicrotasks` in the same `describe('SyncStreamGrpcController', ...)` block. Add each new `describe` block as a sibling block **inside** the existing top-level `describe('SyncStreamGrpcController', ...)` so it shares the `beforeEach` that wires up `controller` and the mocks. Do not duplicate the helpers.

## pushFn capture pattern (used by every task below)

Mirror the pattern already used in the spec file's "cursor-too-old" task (line 315–319). At the top of each task that needs to invoke the live listener directly:

```ts
let capturedPushFn: ((events: Array<{ id: number; entity: string; refId: string; action: string }>) => void) | undefined;
(syncStreamService.register as jest.Mock).mockImplementation((_userId, fn) => {
  capturedPushFn = fn;
});
```

…then in the test body call `capturedPushFn!([...])` to simulate `SyncStreamService` flushing a debounced batch. The argument shape is the **raw event** (no `createdAt`) — `pushFn` stamps `createdAt` itself with `new Date().toISOString()`. Therefore live-event timestamp assertions must use `expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)` rather than an exact value.

## Tasks

### Phase 1: SyncStreamGrpcController — live push, buffer and teardown spec

- [x] **Task 1: Listener registers before replay starts (gap prevention)**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should call syncStreamService.register before changeLogService.getMinEventId is called` — record call order: have both `syncStreamService.register` and `changeLogService.getMinEventId` push a label into a shared `callOrder: string[]` array via `mockImplementation`. Pass a request with `afterId: 0` so replay proceeds. `await flushMicrotasks()`. Assert `callOrder[0] === 'register'` and `callOrder[1] === 'getMinEventId'`. This proves the register call is synchronous in `watchChanges` and runs before `replay()`'s first `await` (line 72 of controller runs before line 83).
  - `should call syncStreamService.register before changeLogService.getChanges is called` — same pattern but include `getChanges` in the `callOrder`; assert `'register'` appears before `'getChanges'`.
  - `should call activeStreamRegistry.register before syncStreamService.register` — same pattern; assert order `activeStreamRegistry.register` → `syncStreamService.register` (line 43 runs before line 72). Closes any future refactor that reorders the two registrations.

- [x] **Task 2: Live-only mode (afterId === undefined) — direct delivery via pushFn**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should emit a ChangeEvent wrapper directly via subscriber.next when pushFn is invoked in live-only mode` — request is `{}` (no `afterId`); capture `pushFn`; `await flushMicrotasks()` (lets `replay()` flip `isDirect = true` on line 77); collect emissions; call `capturedPushFn!([{ id: 11, entity: 'e', refId: 'r', action: 'created' }])`; assert collected emissions has length 1 and `emitted[0].events[0].id === 11`.
  - `should preserve raw event fields (id, entity, refId, action) when emitting via pushFn in live-only mode` — same setup; push one event with explicit fields; assert `emitted[0].events[0]` equals those four fields.
  - `should stamp createdAt as an ISO 8601 string on each event emitted via pushFn` — assert `emitted[0].events[0].createdAt` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/`. Do not assert exact value (assigned via `new Date().toISOString()` at push time).
  - `should not buffer events in live-only mode — every pushFn invocation emits a new wrapper` — push two separate batches via two `capturedPushFn!(...)` calls; assert collected emissions has length 2 (proves the buffer path is not taken once `isDirect` flipped).
  - `should flip isDirect synchronously in live-only mode so pushFn emits immediately without awaiting microtasks` — request is `{}` (no `afterId`); capture `pushFn`; subscribe; **without** awaiting microtasks, call `capturedPushFn!([{ id: 1, entity: 'e', refId: 'r', action: 'created' }])`; assert collected emissions has length 1 and `emitted[0].events[0].id === 1`. Rationale: the live-only branch of `replay` (lines 75–78) has no `await` before `isDirect = true; return;`, so the async function body executes synchronously to completion when the Observable executor invokes `replay()`. The `pushFn` registered on line 72 therefore sees `isDirect === true` by the time the test's `subscribe()` call returns. This pins the synchronous flip as part of the controller's contract: if a future refactor inserts any `await` before line 77 (for example, an awaited side-effect such as logging or metrics), `isDirect` would still be `false` at the time of the synchronous push and the assertion would fail. Note: do **NOT** add a separate "buffer-then-flush" test in live-only mode — the flush block at lines 118–127 is unreachable in this branch because line 78 `return`s before reaching it.

- [x] **Task 3: Buffer flush after replay (gap prevention + dedup at boundary)**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should buffer events delivered during replay and flush them after replay completes` — setup: `afterId=10`, `getMinEventId` resolves `1`, `getChanges` resolves `{ events: [makeDbEvent({ id: 50 })], cursor: 50, hasMore: false }`. Capture `pushFn`. Crucially, before `await flushMicrotasks()` (i.e. while `isDirect === false`), call `capturedPushFn!([{ id: 101, entity: 'e', refId: 'r', action: 'created' }])`. Then `await flushMicrotasks()`. Assert collected emissions has length 2: the replay batch (`emitted[0].events[0].id === 50`) followed by the flushed live batch (`emitted[1].events[0].id === 101`).
  - `should filter buffered events whose id is less than or equal to lastReplayedCursor before flushing` — setup `getChanges` to resolve with `cursor: 100` and at least one event; before flushing microtasks, push `capturedPushFn!([{ id: 95, ... }, { id: 100, ... }, { id: 101, ... }, { id: 105, ... }])`; `await flushMicrotasks()`; locate the flush emission (the wrapper that follows the replay wrapper) and assert its `events` array contains exactly two entries with `id === 101` and `id === 105`. Ids `95` and `100` must be excluded (boundary uses strict `>`).
  - `should emit no flush wrapper when every buffered event id is at or below lastReplayedCursor` — push only events with ids `<= cursor` while `isDirect === false`; after `flushMicrotasks()`, assert the only emission is the replay wrapper (no second wrapper from `liveBuffer.splice(0).filter(...)` because `pending.length === 0` on line 121).
  - `should clear the buffer after flushing — subsequent pushFn calls do not re-emit flushed events` — push events into the buffer while replay is in flight, `await flushMicrotasks()` to trigger the flush, then call `capturedPushFn!([{ id: 200, ... }])` and assert the new wrapper contains only the new event (no leftover ids). Proves `liveBuffer.splice(0)` actually drains the array.

- [x] **Task 4: Direct-mode boundary-straddle dedup (pushFn after replay)**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should drop direct-mode events whose id is less than or equal to lastReplayedCursor` — setup `afterId=10`, `getMinEventId` resolves `1`, `getChanges` resolves `{ events: [makeDbEvent({ id: 100 })], cursor: 100, hasMore: false }`. Capture `pushFn`. `await flushMicrotasks()` so `isDirect = true` and `lastReplayedCursor = 100`. Call `capturedPushFn!([{ id: 98, ... }, { id: 100, ... }, { id: 102, ... }, { id: 105, ... }])`. Assert one additional wrapper was emitted after the replay wrapper, containing exactly two entries: `id === 102` and `id === 105` (ids `98` and `100` dropped by the strict `>` filter on line 63).
  - `should not call subscriber.next when every direct-mode event id is at or below lastReplayedCursor` — same setup, but push only events with `id <= 100`; assert collected emissions length is unchanged after the push (replay wrapper only — the controller short-circuits at the `if (fresh.length > 0)` guard on line 64).
  - `should emit all direct-mode events when every id is strictly greater than lastReplayedCursor` — same setup, push `[{ id: 200, ... }, { id: 300, ... }]`; assert the additional wrapper's `events` array has length 2 with both ids preserved.
  - `should stamp createdAt as an ISO 8601 string on direct-mode events` — assert the direct-mode wrapper's `events[0].createdAt` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/`. Same `new Date().toISOString()` stamp as live-only mode.

- [x] **Task 5: Teardown via subscription.unsubscribe()**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should call activeStreamRegistry.deregister with (userId, subscriber) when the subscription is unsubscribed` — subscribe to `controller.watchChanges({}, user)`, immediately call `sub.unsubscribe()`, assert `activeStreamRegistry.deregister` was called with `(user.sub, expect.any(Subscriber))`.
  - `should call syncStreamService.deregister with (userId, pushFn) when the subscription is unsubscribed` — capture `pushFn`; subscribe; `sub.unsubscribe()`; assert `syncStreamService.deregister` was called with `(user.sub, capturedPushFn)`.
  - `should not call activeStreamRegistry.deregister or syncStreamService.deregister before unsubscribe` — subscribe and `await flushMicrotasks()`; assert neither deregister was called (only after `unsubscribe()` runs the teardown registered via `subscriber.add(...)`).
  - `should call syncStreamService.deregister exactly twice on the cursor-too-old path (explicit + teardown)` — setup `afterId=50`, `getMinEventId` resolves `100`; capture `pushFn`; subscribe with an `error` handler; `await flushMicrotasks()`; assert `syncStreamService.deregister` was called twice, both calls with arguments `(user.sub, capturedPushFn)`. The first call is the explicit `deregister` on line 87 before the error is emitted; the second is the `subscriber.add(...)` teardown that fires when `subscriber.error(...)` closes the subscriber (line 132–135). The test name documents the deliberate double-call.
  - `should not throw when syncStreamService.deregister is invoked twice on the cursor-too-old path` — same setup as above; rely on the default `jest.fn()` (which does not throw) to assert the double invocation is safe under the contract `SyncStreamService.deregister` advertises (idempotent no-op for unknown callback). No `try/catch` needed — if the controller wraps the teardown in error-handling logic in a future refactor, the test still passes; if a regression makes the controller propagate a thrown error from teardown, the subscription's `error` handler will fire a second time and break `done()`-style assertions elsewhere.
  - `should call activeStreamRegistry.deregister exactly once on the cursor-too-old path` — same setup; assert `activeStreamRegistry.deregister` was called exactly once (only the teardown invokes it; there is no explicit pre-error call for the active-stream registry on line 87). Pins the asymmetry between the two registries.

- [x] **Task 6: subscriber.closed short-circuit inside the replay loop**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should stop calling changeLogService.getChanges once the subscriber unsubscribes mid-replay` — setup `afterId=0`, `getMinEventId` resolves `0`. Stage four `getChanges` resolutions via four chained `mockImplementationOnce(...)` calls (do **not** mix `mockResolvedValueOnce` with `mockImplementationOnce` — they share the same call queue and consume in declaration order, which makes interleaving error-prone). The implementations should return promises resolving to `{ events: [makeDbEvent({ id: 10 })], cursor: 10, hasMore: true }` for #1, #2, #3 and `{ events: [], cursor: 10, hasMore: false }` for #4. In the **second** `mockImplementationOnce`, synchronously call `subRef!.unsubscribe()` *before* returning the resolved value — close over a `subRef` populated right after `controller.watchChanges(...).subscribe(...)`. Then `await flushMicrotasks(10)` to fully drain. Assert `changeLogService.getChanges` was called **exactly twice** with `expect(changeLogService.getChanges).toHaveBeenCalledTimes(2)`. Iter 1 issues call #1, iter 2 issues call #2 (whose `mockImplementationOnce` body synchronously unsubscribes before resolving), iter 3 short-circuits at `if (subscriber.closed) return;` on line 99 before issuing call #3. The count is deterministic — match the precision of Task 5 Test 4's "exactly twice" wording.
  - `should not emit further ChangeEvent wrappers after the subscriber unsubscribes mid-replay` — same setup; collect emissions; after the trigger and the flush, assert `expect(emitted).toHaveLength(1)`. Only iter 1's `subscriber.next(...)` actually delivers a wrapper; iter 2's `subscriber.next(...)` is a no-op because the subscriber was already closed by the synchronous `unsubscribe()` inside the second mock's `mockImplementationOnce` body (RxJS guarantees closed subscribers ignore `next`). Documents the exact-count contract; tightens the previous "≤ 2" upper bound.
  - `should still run the subscriber.add teardown (both deregister calls) when unsubscribe happens mid-replay` — same setup; capture `pushFn`; after the trigger and the flush, assert `activeStreamRegistry.deregister` was called with `(user.sub, expect.any(Subscriber))` and `syncStreamService.deregister` was called with `(user.sub, capturedPushFn)`. Confirms the `subscriber.add(...)` teardown fires regardless of where in the lifecycle the unsubscribe occurs.
