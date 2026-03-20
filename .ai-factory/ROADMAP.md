# Mind API — Roadmap

## Milestones

- [x] **Soft Delete for Breath Sessions** — add nullable `deletedAt` column to `breath_sessions`; migration; update all repository queries to filter `WHERE deletedAt IS NULL`; `remove()` sets `deletedAt = now()` instead of deleting the row
- [x] **Change Events Table** — new `change_events` entity (id serial, entity varchar, refId uuid, action varchar, userId uuid, createdAt timestamp); migration with index on `(user_id, id)`; `ChangeLogService` with `log()`, `logForRecipients()`, `getChanges()`, `getMinEventId()`, `purge()`; see [note](notes/change-events-sync.md)
- [x] **Change Event Emission** — integrate `ChangeLogService.log()` into `BreathSessionsService` for create, update, and soft-delete; explicit call after each mutation; emit NestJS `EventEmitter` event for WebSocket layer to pick up
- [x] **Sync REST Endpoint** — `GET /sync/changes?after=lastEventId&limit=100`; new `SyncController` + `SyncModule`; response: `{ events[], cursor, hasMore }`; when `after < minEventId` → respond `{ fullResync: true }`; requires JWT auth
- [x] **Batch Fetch Endpoint** — `GET /breath_sessions/batch?ids=uuid1,uuid2,...`; new controller method; returns matching sessions array; ownership/visibility rules same as `findOne`; cap at 50 IDs per request
- [x] **WebSocket Sync Push** — new `sync:changed` event on `/live` namespace; `SyncNotifierService` listens to `EventEmitter` change events; debounce 300ms per userId via in-memory timer map; emits events array (entity, refId, action) to user's socket; online client skips `/sync/changes` and goes straight to `/batch`; see [note](notes/change-events-sync.md)
- [ ] **Change Events TTL** — `@Cron` daily job in `SyncModule`; deletes events older than 30 days; `getMinEventId()` used by sync endpoint for full resync detection
