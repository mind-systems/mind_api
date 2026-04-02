## Code Review Summary

**Files Reviewed:** 1 (`docs/sync/sync.md`)
**Risk Level:** 🟢 Low (doc-only change)

### Context Gates

- **ARCHITECTURE.md:** WARN — no conflicts; doc-only change, no module boundaries affected.
- **RULES.md:** WARN — no code changes; rules about non-null assertions and logging are not applicable.
- **ROADMAP.md:** WARN — Phase 12 entry "Fix `docs/sync/sync.md`" aligns with this change's scope. Task correctly marked `[x]`.

### Verification Against Source Code

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
| Stream delivers full event data | Controller pushes full `SyncEventDto` via `subscriber.next()` | ✅ |
| `SyncNotifierService` → `SyncStreamService` | No `sync-notifier` file exists; `SyncStreamService` handles `@OnEvent(CHANGE_EVENT_LOGGED)` | ✅ |
| `ChangeLogService.log(entity, refId, action, userId)` | `src/changelog/changelog.service.ts:22-27` | ✅ |
| `SyncService.purgeOldEvents` | `src/sync/sync.service.ts:24` | ✅ |

### Suggestions

**1. WatchChanges example omits `created_at` (line 73)**

The `ChangeEvent` example at line 73 shows:
```proto
{ id: 42, entity: "breath_session", ref_id: "uuid...", action: "created" }
```

But `created_at` IS present in streamed events. The controller adds it both for replay events (`sync-stream.grpc.controller.ts:109` — `createdAt: e.createdAt.toISOString()`) and live events (`sync-stream.grpc.controller.ts:56-59` — `createdAt: new Date().toISOString()`). The proto `SyncEventDto` includes `created_at` as field 5 (`proto/sync.proto:18`).

Line 68 says "той же формы, что и события в `GetChanges`" — and the GetChanges example at lines 37-38 correctly includes `created_at: "..."`. The WatchChanges example should match.

**Fix:** Add `created_at: "..."` to the event in the WatchChanges example at line 73.

### Positive Notes

- All six plan tasks executed correctly — intro, both transport sections, stale service reference, navigation link, and dead See Also links are all addressed.
- Proto message shapes, field names, and types are accurate throughout.
- Correctly uses snake_case field names (proto convention) in examples, replacing the old camelCase (JSON convention).
- TTL section updated `fullResync` → `full_resync` to match proto naming.
- Russian language maintained consistently, matching all neighboring docs in `docs/`.
