# Test Plan: SyncStreamGrpcController — replay phase spec

## Context
`SyncStreamGrpcController.watchChanges` is a gRPC server-streaming endpoint that authenticates the caller, replays historical change events in batches via `ChangeLogService.getChanges()` (after validating the cursor against `ChangeLogService.getMinEventId()`), and then transitions to live push. No spec exists for this controller — this plan covers the auth gate, the live-only short-circuit, and the replay-phase behavior (single-batch, multi-batch, cursor validation, sentinel, empty-changelog bypass, and empty-batch skipping).

### Out of scope (deliberately deferred to follow-up specs)
- Live-buffer flush after replay completes (`liveBuffer.splice(0)` path, lines 118–123).
- `isDirect = true` transition after a successful replay (and the resulting pushFn behavior change).
- pushFn dedup filter on direct-mode events (`fresh = stamped.filter((e) => e.id > lastReplayedCursor)`).
- `subscriber.closed` short-circuit inside the while loop (line 99).
- `replay().catch((err) => subscriber.error(err))` propagation when `getChanges` rejects.
- The `subscriber.add(...)` teardown path (other than the explicit pre-error `deregister` covered in Task 5).

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/realtime/sync-stream.grpc.controller.spec.ts`

## Target Spec File
`src/realtime/sync-stream.grpc.controller.spec.ts`

## Shared helper (used by Tasks 2–7)

The sibling spec `src/realtime/module-state.grpc.controller.spec.ts` already defines a microtask-draining helper. Copy it into this spec file for consistency:

```ts
async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
```

Use `await flushMicrotasks()` (or `await flushMicrotasks(5)` for multi-batch cases — Tasks 4 and the second case of Task 7) to let the chained `await getMinEventId()` → `while`-looped `await getChanges()` resolve before assertions. Do **not** use `setTimeout(0)` — that diverges from the project convention.

## pushFn capture pattern (used by Task 5)

Mirror the `capturedSubscriber` pattern from `module-state.grpc.controller.spec.ts` (line 204). At the top of the relevant test:

```ts
let capturedPushFn: ((events: any[]) => void) | undefined;
(syncStreamService.register as jest.Mock).mockImplementation((_userId, fn) => {
  capturedPushFn = fn;
});
```

…then assert `expect(syncStreamService.deregister).toHaveBeenCalledWith(userId, capturedPushFn)`.

## Tasks

### Phase 1: SyncStreamGrpcController — replay phase spec

- [x] **Task 1: Authentication gate**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should emit UNAUTHENTICATED RpcException when user is null` — subscribe to `controller.watchChanges(request, null)` and assert the `error` callback receives an `RpcException` whose error payload has `code === GrpcStatus.UNAUTHENTICATED` and message `'Missing user context'`.
  - `should not call any collaborator when user is null` — assert `activeStreamRegistry.register`, `syncStreamService.register`, `changeLogService.getMinEventId`, and `changeLogService.getChanges` were never invoked.

- [x] **Task 2: Live-only mode (afterId === undefined) and unconditional registrations**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should not call changeLogService.getMinEventId when afterId is undefined` — pass a request with no `afterId`, `await flushMicrotasks()`, assert `getMinEventId` was never called.
  - `should not call changeLogService.getChanges when afterId is undefined` — same setup, assert `getChanges` was never called.
  - `should register the live push listener via syncStreamService unconditionally when watchChanges is invoked` — assert `syncStreamService.register` was called once with `(userId, expect.any(Function))`. **Important:** `register` runs unconditionally and synchronously in `watchChanges` (line 72), before `replay()` is dispatched — it is **not** specific to the `afterId === undefined` branch. The test name must avoid implying conditional behavior; verify the same behavior also holds when `afterId` is provided (covered implicitly by Tasks 3/4 setup but worth restating here as a sanity assertion).
  - `should register the subscriber with activeStreamRegistry unconditionally when watchChanges is invoked` — assert `activeStreamRegistry.register` was called with `(userId, subscriber)`. Same unconditional-call rationale as above.

- [x] **Task 3: Single-batch replay (hasMore: false)**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should call changeLogService.getMinEventId once when afterId is provided` — assert exactly one call.
  - `should call changeLogService.getChanges once with (userId, Number(afterId), 100) when hasMore is false on first call` — `getChanges` resolves with `{ events: [<one event>], cursor: 42, hasMore: false }`; assert one call only, with arguments `(userId, <numeric afterId>, 100)`. The controller wraps `request.afterId` in `Number(...)` at line 81; expectations should use the explicit numeric value (e.g. `42`) rather than the original boxed request field, so the test survives a future proto type change (e.g. int64 → string/bigint).
  - `should emit exactly one ChangeEvent wrapper message when replay returns a single non-empty batch with hasMore false` — collect emissions via `subscribe({ next })`, assert collected array has length 1. Each collected item is the **`ChangeEvent` wrapper** (shape `{ events: SyncEventDto[] }`), not a single event.
  - `should convert each replay event's createdAt Date to an ISO string in the emitted ChangeEvent wrapper` — the input event's `createdAt` is a fixed `Date`; assert `emitted[0].events[0].createdAt === fixedDate.toISOString()` (explicitly index through the wrapper's `events` array — `emitted[0]` is the wrapper, `emitted[0].events[0]` is the inner `SyncEventDto`).
  - `should preserve id, entity, refId and action fields from the replay event in the emitted wrapper's inner event` — assert `emitted[0].events[0].id`, `emitted[0].events[0].entity`, `emitted[0].events[0].refId`, `emitted[0].events[0].action` equal the source event fields.

- [x] **Task 4: Multi-batch replay (hasMore loop)**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should call changeLogService.getChanges twice when first batch returns hasMore true and second returns hasMore false` — first call resolves `{ events: [<event A>], cursor: 50, hasMore: true }`, second resolves `{ events: [<event B>], cursor: 75, hasMore: false }`; use `await flushMicrotasks(5)` to drain the loop; assert `getChanges` called exactly twice.
  - `should pass Number(request.afterId) as the cursor argument on the first getChanges call` — assert first call arguments equal `(userId, <numeric afterId>, 100)` (use the explicit numeric literal).
  - `should use the cursor returned by the first batch as the second getChanges call's cursor argument` — assert second call arguments equal `(userId, 50, 100)`.
  - `should emit two separate ChangeEvent wrapper messages when replay completes in two non-empty batches` — assert collected emissions have length 2; assert `emitted[0].events[0].id` matches event A and `emitted[1].events[0].id` matches event B (index through the wrapper).
  - `should stop calling getChanges after hasMore becomes false` — assert no third call after additional `await flushMicrotasks(5)`.

- [x] **Task 5: Cursor-too-old → FAILED_PRECONDITION**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should emit FAILED_PRECONDITION RpcException when afterId is below minEventId and afterId is not 0` — setup `afterId=50`, `getMinEventId` resolves `100`; assert error callback receives RpcException with `code === GrpcStatus.FAILED_PRECONDITION` and message `'cursor too old, full resync required'`.
  - `should call syncStreamService.deregister before emitting the FAILED_PRECONDITION error` — track call order (e.g. push a string into a shared array from the `deregister` mock implementation and from the subscriber's `error` callback); assert the `deregister` entry was recorded before the `error` entry.
  - `should not call changeLogService.getChanges when the cursor is too old` — assert `getChanges` was never invoked.
  - `should pass the same pushFn captured by syncStreamService.register to syncStreamService.deregister on cursor-too-old` — use the `capturedPushFn` capture pattern shown above; assert `expect(syncStreamService.deregister).toHaveBeenCalledWith(userId, capturedPushFn)`. **Use `toHaveBeenCalledWith`, not `toHaveBeenCalledTimes(1)`** — the controller's `subscriber.add(...)` teardown (line 132) also calls `deregister` after `subscriber.error()` runs, so `deregister` ends up invoked twice on this path (this is intentional and idempotent — see the line 86 comment); asserting a strict call count would yield a false failure.

- [x] **Task 6: afterId=0 sentinel bypasses cursor check**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should not emit FAILED_PRECONDITION when afterId is 0 even if minEventId is 100` — setup `afterId=0`, `getMinEventId` resolves `100`; assert subscriber `error` was never invoked.
  - `should proceed to call changeLogService.getChanges when afterId is 0 and minEventId is 100` — assert `getChanges` was called with `(userId, 0, 100)`.
  - `should emit replayed events normally when afterId is 0 sentinel` — `getChanges` resolves with one non-empty batch and `hasMore: false`; assert one `ChangeEvent` wrapper message emitted.

- [x] **Task 6b: Empty changelog (minEventId === null) bypasses cursor check**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should not emit FAILED_PRECONDITION when minEventId is null even if afterId is greater than 0` — setup `afterId=50`, `getMinEventId` resolves `null` (changelog table empty, e.g. post-purge / fresh install); assert subscriber `error` was never invoked. Closes the `minEventId !== null` half of the guard at line 84.
  - `should call changeLogService.getChanges with (userId, Number(afterId), 100) when minEventId is null` — same setup with `getChanges` resolving `{ events: [], cursor: 50, hasMore: false }`; assert `getChanges` was called with `(userId, 50, 100)`.

- [x] **Task 7: Empty batches skipped**
  Files: `src/realtime/sync-stream.grpc.controller.spec.ts`
  Test cases:
  - `should not call subscriber.next for a batch whose events array is empty` — `getChanges` resolves `{ events: [], cursor: 10, hasMore: false }`; assert collected emissions has length 0.
  - `should emit only the non-empty batch when one empty batch and one non-empty batch are returned in sequence` — first call resolves `{ events: [], cursor: 5, hasMore: true }`, second resolves `{ events: [<one event>], cursor: 10, hasMore: false }`; use `await flushMicrotasks(5)` to drain both iterations; assert collected emissions has length 1 and `emitted[0].events[0].id` matches the second batch's event.
