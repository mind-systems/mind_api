# Patch: Fix `docs/sync/sync.md`

**Review:** `.ai-factory/reviews/56-fix-docs-sync-sync-md-review-1.md`

## Fix 1: Add missing `created_at` to WatchChanges example

**File:** `docs/sync/sync.md`
**Line:** 73
**Problem:** The `ChangeEvent` example omits `created_at`, but the field IS present in streamed events. The controller adds it for both replay events (`sync-stream.grpc.controller.ts:109`) and live events (`sync-stream.grpc.controller.ts:56-59`). The proto `SyncEventDto` includes `created_at` as field 5 (`proto/sync.proto:18`). Line 68 explicitly says events have "той же формы, что и события в `GetChanges`" — but the GetChanges example at lines 37-38 includes `created_at: "..."` while the WatchChanges example does not.

**Exact fix — replace:**
```
    { id: 42, entity: "breath_session", ref_id: "uuid...", action: "created" }
```
**with:**
```
    { id: 42, entity: "breath_session", ref_id: "uuid...", action: "created", created_at: "..." }
```
