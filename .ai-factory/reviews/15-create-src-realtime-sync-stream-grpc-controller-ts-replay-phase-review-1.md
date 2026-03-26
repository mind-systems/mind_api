# Code Review: Create `sync-stream.grpc.controller.ts` (replay phase)

**Plan:** `15-create-src-realtime-sync-stream-grpc-controller-ts-replay-phase.md`
**Risk Level:** Green

## Files Reviewed

| File | Status |
|------|--------|
| `src/realtime/sync-stream.grpc.controller.ts` | NEW |
| `src/sync/sync.grpc.controller.ts` | MODIFIED |
| `src/realtime/realtime.module.ts` | MODIFIED |

## Verification

- **TypeScript:** Compiles cleanly (`npx tsc --noEmit` — no errors)
- **ESLint:** 7 Prettier formatting violations (all auto-fixable with `npm run format`). No logic/lint errors.
- **`ChangelogModule` is `@Global()`:** Confirmed — `ChangeLogService` is available without explicit module import.
- **`@GrpcMethod` is correct for server streaming:** ts-proto puts `watchChanges` in `grpcMethods` (not `grpcStreamMethods`). The `Observable` return type tells NestJS to stream responses.

## Issues

### 1. Replay loop does not check `subscriber.closed` (resource waste on client disconnect)

`src/realtime/sync-stream.grpc.controller.ts:55-69`

If the client cancels the stream mid-replay, the Observable is unsubscribed and `subscriber.closed` becomes `true`. But the `while (hasMore)` loop has no such check — it continues querying the database for every remaining batch until `hasMore` is false. For a client with `afterId = 0` and a large event history, this runs unbounded DB queries against a disconnected client.

**Fix:** Add a closed check at the top of the loop:

```typescript
while (hasMore) {
  if (subscriber.closed) return;
  const result: ChangesResult = await this.changeLogService.getChanges(userId, cursor, 100);
  // ...
}
```

### 2. Empty `ChangeEvent` message emitted when already caught up

`src/realtime/sync-stream.grpc.controller.ts:58-66`

When the client sends an `afterId` that matches the latest event (already caught up), `getChanges()` returns `{ events: [], cursor: afterId, hasMore: false }`. The code unconditionally calls `subscriber.next({ events: [] })`, sending an empty envelope over the wire before breaking.

**Fix:** Guard the emission:

```typescript
if (result.events.length > 0) {
  subscriber.next({
    events: result.events.map((e) => ({ ... })),
  });
}
```

### 3. Prettier formatting violations (auto-fixable)

Both `sync-stream.grpc.controller.ts` and `sync.grpc.controller.ts` have formatting issues (line length, import grouping, trailing commas). Run `npm run format` to resolve.

## Positive Notes

- **RULES.md compliance:** Both controllers now use explicit null guards instead of `!` — the `SyncGrpcController` was also fixed as a bonus (previously used `user!.sub`).
- **Proto contract respected:** `afterId === undefined` correctly skips replay (live-only mode), matching the proto comment.
- **Full-resync guard:** Triple condition (`minEventId !== null && cursor !== 0 && cursor < minEventId`) correctly mirrors `SyncService.getChanges()` line 35.
- **Error handling:** The `replay().catch()` pattern correctly surfaces unexpected errors. `RpcException` errors from inside replay (FAILED_PRECONDITION) are sent via `subscriber.error()` and the function returns cleanly, so the `.catch()` only handles truly unexpected failures.
- **Teardown stub:** `subscriber.add()` is the correct extension point for future live phase stream cleanup.
- **Clean import split:** `SyncGrpcController` retains only what it uses (`GrpcMethod`, `RpcException`, `GrpcStatus`, `GetChangesRequest`, `GetChangesResponse`). No dead imports.

REVIEW_PASS
