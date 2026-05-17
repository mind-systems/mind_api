# SyncStreamGrpcController — Test Plan

**Date:** 2026-05-17
**Source:** roadmap-test-coverage agent

## Source Overview

`SyncStreamGrpcController` implements a gRPC server-streaming `watchChanges` endpoint that returns `Observable<ChangeEvent>`. It has three phases: (1) authenticate user, (2) replay historical events in batches via `ChangeLogService.getChanges()`, (3) live-push via `SyncStreamService` with 300ms debounce. A `liveBuffer` prevents gaps — the live listener registers before replay starts, buffering events that arrive during replay; after replay, buffered events with `id > lastReplayedCursor` are flushed and the stream switches to direct mode.

## Instantiation

```typescript
const controller = new SyncStreamGrpcController(
  changeLogService,       // mock: getMinEventId(), getChanges()
  syncStreamService,      // mock: register(), deregister()
  activeStreamRegistry,   // mock: register(), deregister()
);
// user is passed as second argument (from @GrpcCurrentUser decorator, bypassed in unit tests)
controller.watchChanges(request, user).subscribe({ next, error, complete });
```

## Existing Coverage

None.

## Test Cases

### Authentication

- should emit UNAUTHENTICATED error immediately when user is null
  - Assert: `changeLogService` never called; `activeStreamRegistry.register` never called

### Live-Only Mode (afterId === undefined)

- should switch to live mode immediately without calling `getChanges()` or `getMinEventId()`
- should deliver live events directly to subscriber once pushFn is captured and called

### Replay — Single Batch

- should emit one `ChangeEvent` batch with all events when `hasMore: false`
  - Assert: `getChanges(userId, 0, 100)` called once; emitted message contains all events; `createdAt` is ISO string

### Replay — Multiple Batches (hasMore Loop)

- should call `getChanges()` sequentially with updated cursor until `hasMore: false`
  - Setup: first call returns `hasMore: true`, second returns `hasMore: false`
  - Assert: two separate `ChangeEvent` messages; second call uses cursor from first batch

### Cursor Too Old → FAILED_PRECONDITION

- should emit FAILED_PRECONDITION error when `afterId < minEventId` and `afterId !== 0`
  - Setup: `minEventId=100`, `afterId=50`
  - Assert: `syncStreamService.deregister()` called before error; error code = FAILED_PRECONDITION

### afterId=0 is Not Subject to Cursor Check

- should NOT trigger FAILED_PRECONDITION when `afterId=0` even if `minEventId=100`
  - Assert: proceeds with replay, emits events normally

### Gap Prevention — Buffer During Replay

- should buffer live events arriving during replay and flush them after replay completes
  - Assert: events buffered while `isDirect === false`; flushed (filtered by `id > lastReplayedCursor`) after replay ends

### Deduplication at Cursor Boundary

- should filter buffered events with `id <= lastReplayedCursor` before flushing
  - Setup: replay sets cursor=100; buffer contains ids [95, 100, 101, 105]
  - Assert: only [101, 105] emitted in flush batch

- should filter straddle events in direct mode (id <= lastReplayedCursor)
  - Setup: replay complete, `isDirect=true`; pushFn called with [98, 100, 102, 105]
  - Assert: only [102, 105] emitted

### Direct Mode After Replay

- should emit live events directly without filtering when id > lastReplayedCursor

### Empty Batches Skipped

- should not emit a `ChangeEvent` message for batches where `result.events.length === 0`
  - Assert: emitted message count = non-empty batches only

### Subscriber Closed During Replay

- should stop replay loop when `subscriber.closed === true`
  - Setup: unsubscribe mid-replay; verify `getChanges()` call count < expected total

### Teardown

- should call `activeStreamRegistry.deregister(userId, subscriber)` on unsubscribe
- should call `syncStreamService.deregister(userId, pushFn)` on unsubscribe
- should call `syncStreamService.deregister()` twice when cursor-too-old (explicit + teardown) — both calls must be safe (idempotent)

### createdAt Timestamps

- should convert replay `event.createdAt` (Date) to ISO string
- should assign `new Date().toISOString()` to live events (no DB timestamp available)

## Gotchas

1. **Observable must be subscribed** — execution starts only when `.subscribe()` is called; teardown triggered only on unsubscribe/complete/error.
2. **`replay()` is fire-and-forget** — runs async after Observable setup; tests need `await new Promise(r => setTimeout(r, N))` to let replay complete.
3. **Capturing `pushFn`** — mock `syncStreamService.register` to capture the passed callback, then call it in tests to simulate live events.
4. **`isDirect` flag timing** — call `pushFn` before replay completes to test buffering; after replay to test direct mode. Control replay completion with mock delays.
5. **Teardown via `subscriber.add()`** — registered after replay starts; must call `subscription.unsubscribe()` to trigger it.
6. **`activeStreamRegistry` vs `syncStreamService`** — two separate registries; both must be mocked and deregistered independently.
7. **`afterId=0` is sentinel** — `cursor !== 0 && cursor < minEventId` is the full condition; `afterId=0` always bypasses the cursor-too-old check.
8. **Live event `createdAt`** — assigned at push time (`new Date().toISOString()`); assert with `expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)` not exact value.
9. **`request.afterId` type** — `undefined` = live-only mode; `0` = replay from start. Test both explicitly.
10. **Empty batch cursor** — cursor still advances even for empty batches; `hasMore: true` with empty events can loop; assume service guarantees progress.
