# Patch: 15-create-src-realtime-sync-stream-grpc-controller-ts-replay-phase

Addresses all issues from `reviews/15-create-src-realtime-sync-stream-grpc-controller-ts-replay-phase-review-1.md`.

## Issue 1: Replay loop does not check `subscriber.closed` — unbounded DB queries on client disconnect

When a client cancels the gRPC stream mid-replay, the RxJS `Subscriber` becomes closed but the `while (hasMore)` loop continues querying the database for every remaining batch. For a client with `afterId = 0` and a large event history this runs unbounded DB queries against a disconnected client.

### Fix 1a: Add `subscriber.closed` guard at the top of the replay loop

**File:** `src/realtime/sync-stream.grpc.controller.ts`

```typescript
// BEFORE (lines 97-114)
        let hasMore = true;
        while (hasMore) {
          const result: ChangesResult = await this.changeLogService.getChanges(userId, cursor, 100);
          // Skip empty batches to avoid sending no-op messages to the client.
          if (result.events.length > 0) {
            subscriber.next({
              events: result.events.map((e) => ({
                id: e.id,
                entity: e.entity,
                refId: e.refId,
                action: e.action,
                createdAt: e.createdAt.toISOString(),
              })),
            });
          }
          cursor = result.cursor;
          lastReplayedCursor = result.cursor;
          hasMore = result.hasMore;
        }
```

```typescript
// AFTER
        let hasMore = true;
        while (hasMore) {
          if (subscriber.closed) return;
          const result: ChangesResult = await this.changeLogService.getChanges(userId, cursor, 100);
          // Skip empty batches to avoid sending no-op messages to the client.
          if (result.events.length > 0) {
            subscriber.next({
              events: result.events.map((e) => ({
                id: e.id,
                entity: e.entity,
                refId: e.refId,
                action: e.action,
                createdAt: e.createdAt.toISOString(),
              })),
            });
          }
          cursor = result.cursor;
          lastReplayedCursor = result.cursor;
          hasMore = result.hasMore;
        }
```

**What changes:** Add `if (subscriber.closed) return;` as the first line inside the `while (hasMore)` loop (after line 98). When the client cancels the stream, RxJS triggers teardown and sets `subscriber.closed = true`. The guard exits the async replay function immediately, preventing further DB queries. The teardown callback (line 131) handles deregistration from `ActiveStreamRegistry` and `SyncStreamService` independently — it fires regardless of whether replay completed or was short-circuited.

**Why `return` and not `subscriber.complete()`:** The subscriber is already closed (the client disconnected). Calling `subscriber.complete()` or `subscriber.error()` on a closed subscriber is a no-op at best. A plain `return` exits the async replay, and the teardown registered via `subscriber.add()` has already run.

## Issue 2: Empty `ChangeEvent` message emitted when client is already caught up

**Status: Already fixed.** The subsequent commit `733e428` (live push phase) added the `if (result.events.length > 0)` guard at line 101. No action needed.
