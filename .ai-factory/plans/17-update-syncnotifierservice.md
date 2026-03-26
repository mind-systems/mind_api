# Plan: Update SyncNotifierService

## Context
Remove the Socket.IO-dependent `SyncNotifierService` — it duplicates the debounce+push logic already handled by `SyncStreamService`, which has zero Socket.IO dependencies and integrates cleanly with the gRPC streaming controller via callbacks. After deletion, `SyncStreamService` becomes the sole live-push mechanism for sync changes.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Delete the Socket.IO service and clean up the module

- [x] **Task 1: Delete `SyncNotifierService` and remove from module**
  Files: `src/realtime/services/sync-notifier.service.ts`, `src/realtime/realtime.module.ts`
  Delete the file `src/realtime/services/sync-notifier.service.ts` entirely. In `realtime.module.ts`, remove the `SyncNotifierService` import line and its entry from the `providers` array. No other file imports `SyncNotifierService` — the service used `@OnEvent(CHANGE_EVENT_LOGGED)` so it has no injection-site dependents.

- [x] **Task 2: Remove `SYNC_CHANGED` constant from `live.events.ts`** (depends on Task 1)
  Files: `src/realtime/events/live.events.ts`
  Remove the line `export const SYNC_CHANGED = 'sync:changed';`. The only consumer was `SyncNotifierService` (confirmed by grep — no other file imports `SYNC_CHANGED`). All other constants in the file remain untouched.
