# Plan: Change Event Emission

## Context
Wire `ChangeLogService.log()` into every `BreathSessionsService` mutation (create, update, replace, soft-delete) so each change is recorded in `change_events`, then emit an `EventEmitter2` event that a future WebSocket `SyncNotifierService` can subscribe to.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Event constants and payload type

- [x] **Task 1: Define change-event constants and payload interface**
  Files: `src/changelog/changelog.events.ts`
  Create a new file that exports:
  - A string constant `CHANGE_EVENT_LOGGED = 'changelog.logged'` (follows the `domain.action` naming pattern used in `src/realtime/events/live.events.ts`, e.g. `live_session.paused`).
  - An interface `ChangeEventPayload { entity: string; refId: string; action: string; userId: string }` — this is the shape the EventEmitter carries so listeners are type-safe.

### Phase 2: Integrate into BreathSessionsService

- [x] **Task 2: Inject ChangeLogService and EventEmitter2 into BreathSessionsService**
  Files: `src/breath-sessions/breath-sessions.service.ts`
  Add `ChangeLogService` and `EventEmitter2` to the constructor. `ChangeLogService` is `@Global()` so no module import change is needed. `EventEmitterModule.forRoot()` is already registered in `AppModule`, so `EventEmitter2` is injectable everywhere. No changes to `breath-sessions.module.ts` required.

- [x] **Task 3: Emit change event on create** (depends on Task 1, Task 2)
  Files: `src/breath-sessions/breath-sessions.service.ts`
  In `create()`: after `breathSessionRepository.save()` returns the saved entity, call `this.changeLogService.log('breath_session', saved.id, 'created', userId)` and then `this.eventEmitter.emit(CHANGE_EVENT_LOGGED, payload)` with the matching `ChangeEventPayload`. Use the saved entity's `id` as `refId`.

- [x] **Task 4: Emit change event on update and replace** (depends on Task 2)
  Files: `src/breath-sessions/breath-sessions.service.ts`
  In both `update()` and `replace()`: after `breathSessionRepository.save()` returns, call `this.changeLogService.log('breath_session', session.id, 'updated', userId)` followed by `this.eventEmitter.emit(CHANGE_EVENT_LOGGED, payload)`. Both PATCH and PUT count as the same `'updated'` action — the changelog tracks that a change happened, not what changed.

- [x] **Task 5: Emit change event on soft-delete** (depends on Task 2)
  Files: `src/breath-sessions/breath-sessions.service.ts`
  In `remove()`: after `breathSessionRepository.softRemove()` completes, call `this.changeLogService.log('breath_session', id, 'deleted', userId)` and `this.eventEmitter.emit(CHANGE_EVENT_LOGGED, payload)`.

### Phase 3: Re-export for consumers

- [x] **Task 6: Re-export event constants from ChangelogModule barrel**
  Files: `src/changelog/index.ts`
  Create a barrel file that re-exports `CHANGE_EVENT_LOGGED` and `ChangeEventPayload` from `changelog.events.ts`. This gives the future `SyncNotifierService` (in the realtime or sync module) a clean import path: `import { CHANGE_EVENT_LOGGED, ChangeEventPayload } from 'src/changelog'`.
