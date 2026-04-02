## Code Review Summary

**Files Reviewed:** 1 code change (`docs/sync/sync.md`), 2 metadata files (patch + review)
**Risk Level:** 🟢 Low (doc-only change)

### Changes

Single-line fix in `docs/sync/sync.md:73` — adds `created_at: "..."` to the WatchChanges `ChangeEvent` example, matching the GetChanges example (lines 37-38) and the proto `SyncEventDto` definition (`proto/sync.proto:18`).

### Verification

- Line 73 now reads `{ id: 42, entity: "breath_session", ref_id: "uuid...", action: "created", created_at: "..." }` — consistent with the GetChanges example and the claim on line 68 that events have "той же формы, что и события в `GetChanges`".
- The controller confirms `created_at` is present in both code paths: replay (`sync-stream.grpc.controller.ts:109`) and live push (`sync-stream.grpc.controller.ts:56-59`).

### Issues

None.

REVIEW_PASS
