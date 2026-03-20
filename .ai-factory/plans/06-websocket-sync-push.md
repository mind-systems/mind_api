# Plan: WebSocket Sync Push

## Context
Add real-time push delivery of change events to connected clients via a `sync:changed` event on the `/live` WebSocket namespace. An online client receives change events through the socket (debounced per user), skips `GET /sync/changes`, and goes straight to `GET /breath_sessions/batch` — one HTTP request instead of two.

Design note: `.ai-factory/notes/change-events-sync.md` (WebSocket Push section).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Changelog payload enrichment

- [x] **Task 1: Return event id from `ChangeLogService.log()` and extend `ChangeEventPayload`**
  Files: `src/changelog/changelog.service.ts`, `src/changelog/changelog.events.ts`, `src/changelog/index.ts`

  The pushed `sync:changed` events must carry the sequential `id` so the client can update its cursor without calling `/sync/changes`. Currently `log()` returns `void` and `ChangeEventPayload` has no `id`.

  In `changelog.service.ts`: change `log()` return type from `Promise<void>` to `Promise<number>`. Use `this.changeEventRepo.insert(...)` — TypeORM's `InsertResult.identifiers[0].id` gives the generated serial. Return it.

  In `changelog.events.ts`: add `id: number` to the `ChangeEventPayload` interface.

  `index.ts` re-exports the type, no change needed there.

- [x] **Task 2: Pass event id through all emit sites in `BreathSessionsService`** (depends on Task 1)
  Files: `src/breath-sessions/breath-sessions.service.ts`

  There are 4 emit sites (lines ~59-66 `create`, ~201-208 `update`, ~240-247 `replace`, ~306-313 `remove`). Each follows the same pattern:
  ```ts
  await this.changeLogService.log('breath_session', id, action, userId);
  const payload: ChangeEventPayload = { entity, refId, action, userId };
  this.eventEmitter.emit(CHANGE_EVENT_LOGGED, payload);
  ```

  Update each site to capture the returned id and include it in the payload:
  ```ts
  const eventId = await this.changeLogService.log('breath_session', id, action, userId);
  const payload: ChangeEventPayload = { id: eventId, entity, refId, action, userId };
  this.eventEmitter.emit(CHANGE_EVENT_LOGGED, payload);
  ```

### Phase 2: SyncNotifierService

- [x] **Task 3: Add `SYNC_CHANGED` event constant**
  Files: `src/realtime/events/live.events.ts`

  Add `export const SYNC_CHANGED = 'sync:changed';` — follows the existing naming convention in this file (`session:state`, `session:error`, etc.).

- [x] **Task 4: Create `SyncNotifierService`** (depends on Tasks 1, 3)
  Files: `src/realtime/services/sync-notifier.service.ts`

  New `@Injectable()` service in the realtime module. Inject `StateStore`.

  Core mechanics:
  - In-memory `Map<string, { timer: NodeJS.Timeout; events: Array<{ id: number; entity: string; refId: string; action: string }> }>` keyed by userId.
  - `@OnEvent(CHANGE_EVENT_LOGGED)` handler receives `ChangeEventPayload`. Extract `userId` from the payload. If the user has no socket in `stateStore.socketMap` — return early (no point buffering for offline users; they'll use REST poll on reconnect).
  - If a pending entry exists for this userId, push the new event onto its `events` array (the timer is already running). If no entry exists, create one with a fresh 300ms `setTimeout`. When the timer fires: look up the socket from `stateStore.socketMap`, emit `SYNC_CHANGED` with `{ events }`, then delete the map entry.
  - Import `CHANGE_EVENT_LOGGED` / `ChangeEventPayload` from `src/changelog` and `SYNC_CHANGED` from `../events/live.events`.

  Cleanup: add an `onModuleDestroy()` lifecycle hook that clears all pending timers (prevents dangling timers on graceful shutdown).

  Follow the existing service pattern in `src/realtime/services/` (injectable, `Logger` from `@nestjs/common`).

- [x] **Task 5: Register `SyncNotifierService` in `RealtimeModule`** (depends on Task 4)
  Files: `src/realtime/realtime.module.ts`

  Add `SyncNotifierService` to the `providers` array. Import from `./services/sync-notifier.service`. No need to export — it is consumed internally via the event listener, not by other modules.

## Commit Plan
- **Commit 1** (after tasks 1-2): "Expose change event id in EventEmitter payloads"
- **Commit 2** (after tasks 3-5): "Add SyncNotifierService for real-time sync push on /live namespace"
