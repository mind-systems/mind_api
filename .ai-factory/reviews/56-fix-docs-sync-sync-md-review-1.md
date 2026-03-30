# Code Review: Fix `docs/sync/sync.md`

**Plan file:** `.ai-factory/plans/56-fix-docs-sync-sync-md.md`
**Files changed:** `docs/sync/sync.md`
**Risk Level:** 🟢 Low (doc-only change)

## Verification Against Codebase

| Doc claim | Source | Verified |
|---|---|---|
| `GetChanges` in `SyncGrpcController` (SyncModule) | `src/sync/sync.grpc.controller.ts:16,21` | ✅ |
| `WatchChanges` in `SyncStreamGrpcController` (RealtimeModule) | `src/realtime/sync-stream.grpc.controller.ts:21,28` | ✅ |
| Proto: `rpc GetChanges(GetChangesRequest) returns (GetChangesResponse)` | `proto/sync.proto:80` | ✅ |
| Proto: `rpc WatchChanges(WatchChangesRequest) returns (stream ChangeEvent)` | `proto/sync.proto:81` | ✅ |
| Auth via `GrpcAuthInterceptor` | Both controllers use `@UseInterceptors(GrpcAuthInterceptor)` | ✅ |
| `GetChangesRequest`: `after` (int64), `limit` (int32) | `proto/sync.proto:36-39` | ✅ |
| `GetChangesResponse`: `oneof result` with `SyncChangesPayload` or `full_resync` | `proto/sync.proto:45-50` | ✅ |
| `WatchChangesRequest`: optional `after_id` (int64) | `proto/sync.proto:57-59` | ✅ |
| Too-old cursor → `FAILED_PRECONDITION` | `sync-stream.grpc.controller.ts:88-93` | ✅ |
| 300 ms debounce by `SyncStreamService` | `sync-stream.service.ts:59` (`setTimeout(..., 300)`) | ✅ |
| `ChangeEvent` wraps `repeated SyncEventDto` | `proto/sync.proto:65-67` | ✅ |
| Stream delivers full event data (no separate RPC needed) | Controller pushes full `SyncEventDto` with all fields via `subscriber.next()` | ✅ |
| `SyncNotifierService` replaced by `SyncStreamService` | No `sync-notifier` file exists; `SyncStreamService` handles `@OnEvent(CHANGE_EVENT_LOGGED)` | ✅ |
| `ChangeLogService.log(entity, refId, action, userId)` (line 88) | `src/changelog/changelog.service.ts:22-27` | ✅ |
| `SyncService.purgeOldEvents` (line 82) | `src/sync/sync.service.ts:24` | ✅ |
| "Back to README" link removed | Not in diff output | ✅ |
| "See Also" section removed | Not in diff output | ✅ |
| Intro updated: both REST and WebSocket replaced with gRPC | Line 3 of new doc | ✅ |

## Issues

### 1. WatchChanges example omits `created_at` (minor inaccuracy)

**File:** `docs/sync/sync.md:70-76`

The WatchChanges `ChangeEvent` example shows events without `created_at`:

```proto
ChangeEvent {
  events: [
    { id: 42, entity: "breath_session", ref_id: "uuid...", action: "created" }
  ]
}
```

But `created_at` IS present in streamed events. The controller adds it both for replay events (`sync-stream.grpc.controller.ts:109`) and live events (`sync-stream.grpc.controller.ts:56-59`). The proto `SyncEventDto` message includes `created_at` as field 5 (`proto/sync.proto:18`).

This contradicts line 68 which says "той же формы, что и события в `GetChanges`" — the GetChanges example at lines 37-38 correctly includes `created_at`.

**Fix:** Add `created_at: "..."` to the event in the WatchChanges example to match the GetChanges example and actual behavior.

## Positive Notes

- All six plan tasks executed correctly — every stale reference is updated.
- Proto message shapes, field names, and types are accurate throughout.
- Correctly uses snake_case field names (proto convention) instead of the old camelCase (JSON convention) in examples.
- TTL section updated `fullResync` → `full_resync` to match proto naming.
- Russian language maintained consistently.
- Navigation link and dead See Also links removed per documentation rules.

REVIEW_PASS
