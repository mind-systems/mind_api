## Code Review Summary

**Files Reviewed:** 3
**Risk Level:** 🟡 Medium

| File | Status |
|------|--------|
| `src/realtime/sync-stream.grpc.controller.ts` | NEW (80 lines) |
| `src/sync/sync.grpc.controller.ts` | MODIFIED |
| `src/realtime/realtime.module.ts` | MODIFIED |

### Context Gates

- **ARCHITECTURE.md:** WARN — Controller creates `ChangeEvent` proto objects inline (field mapping at lines 58-65) rather than delegating to a service. This is borderline — the mapping is mechanical (entity → proto DTO), not business logic. Acceptable for now, but if more controllers need the same mapping, extract to a shared mapper.
- **RULES.md:** OK — No `!` assertions. Explicit null guard on `user`. No sensitive data logged.
- **ROADMAP.md:** OK — Milestone correctly marked `[x]` in ROADMAP. Scope matches the roadmap description.

### Critical Issues

**1. Replay loop does not check `subscriber.closed` — unbounded DB queries on client disconnect**
`src/realtime/sync-stream.grpc.controller.ts:55-69`

When a client cancels the gRPC stream mid-replay, the RxJS `Subscriber` becomes closed, but the `while (hasMore)` loop has no such check. It continues querying the database for every remaining batch until `hasMore` is `false`. For a client with `afterId = 0` and a large event history, this runs unbounded DB queries against a disconnected client — wasting database resources and holding the async execution context.

Fix:
```typescript
while (hasMore) {
  if (subscriber.closed) return;
  const result: ChangesResult = await this.changeLogService.getChanges(userId, cursor, 100);
  // ...
}
```

**2. Empty `ChangeEvent` message emitted when client is already caught up**
`src/realtime/sync-stream.grpc.controller.ts:56-66`

When the client sends an `afterId` equal to the latest event (already caught up), `getChanges()` returns `{ events: [], cursor: afterId, hasMore: false }`. The code unconditionally calls `subscriber.next({ events: [] })`, sending an empty envelope over the wire before breaking. This is a no-op message that the client must handle defensively.

Fix — guard the emission:
```typescript
if (result.events.length > 0) {
  subscriber.next({
    events: result.events.map((e) => ({ ... })),
  });
}
```

### Suggestions

None beyond the critical issues above.

### Positive Notes

- **RULES.md compliance:** Both controllers use explicit null guards — `SyncGrpcController` was also cleaned up, replacing `user!.sub` with a proper null check and `RpcException`.
- **Proto contract respected:** `afterId === undefined` correctly skips replay (live-only mode), matching the proto comment. The `WatchChangesRequest` interface has `afterId?: number | undefined`, and the check is correct.
- **Full-resync guard:** Triple condition (`minEventId !== null && cursor !== 0 && cursor < minEventId`) correctly mirrors `SyncService.getChanges()` line 35.
- **Error propagation:** `replay().catch()` surfaces unexpected errors to the gRPC stream. `RpcException` errors from inside replay (FAILED_PRECONDITION, UNAUTHENTICATED) are sent via `subscriber.error()` and the function returns, so `.catch()` handles only truly unexpected failures.
- **Clean split:** `SyncGrpcController` retains only what it uses (`GrpcMethod`, `GetChangesRequest`, `GetChangesResponse`). The `@SyncServiceControllerMethods()` class decorator was correctly replaced with an explicit `@GrpcMethod('SyncService', 'getChanges')` to avoid auto-registering `watchChanges`.
- **Teardown stub:** `subscriber.add()` is the correct RxJS extension point for future live phase cleanup.
- **Module registration:** `SyncStreamGrpcController` correctly added to `RealtimeModule.controllers`. `ChangeLogService` is `@Global()` so no module import needed.
