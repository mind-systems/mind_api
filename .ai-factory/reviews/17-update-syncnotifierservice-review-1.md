# Review: Update SyncNotifierService

**Files reviewed:** `src/realtime/services/sync-notifier.service.ts` (deleted), `src/realtime/realtime.module.ts`, `src/realtime/events/live.events.ts`
**Related files read:** `src/realtime/services/sync-stream.service.ts`, `src/realtime/sync-stream.grpc.controller.ts`, `src/realtime/state-store.ts`

## Verification

- [x] `SyncNotifierService` fully deleted — file removed, import and provider entry removed from `RealtimeModule`
- [x] `SYNC_CHANGED` constant removed from `live.events.ts` — grep confirms zero remaining consumers in `src/`
- [x] No dangling imports — `SyncNotifierService` was event-driven (`@OnEvent`), not injected by other services, so no broken DI references
- [x] `SyncStreamService` retained in module providers — controller dependency satisfied
- [x] `SyncStreamGrpcController` unchanged — replay dedup (`lastReplayedCursor`, `liveBuffer`, `isDirect`) preserved
- [x] `tsc --noEmit` passes — clean compile, no type errors
- [x] `socketMap` still used by `LiveGateway` and `ObservabilityService` — correctly left in `StateStore` (cleanup belongs to roadmap 3.6)

## Issues

None found.

## Notes

- Docs (`docs/sync/sync.md`, `docs/socket/overview.md`) still reference `SyncNotifierService` by name and describe the Socket.IO push path. These docs will need updating when the Socket.IO removal (roadmap 3.6) is implemented — not a blocker for this change since the gRPC path is additive.
- `ROADMAP.md` line 64 still describes the old task wording ("Update `SyncNotifierService`"). The roadmap item should be checked off and its description updated to reflect that the service was deleted rather than rewritten. Not a code issue.

REVIEW_PASS
