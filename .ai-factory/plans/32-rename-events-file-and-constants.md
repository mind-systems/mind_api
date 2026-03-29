# Plan: Rename events file and constants

## Context
Rename the legacy `live.events.ts` file and its two constants to use the `module-session` naming convention, keeping the single consumer in sync.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Rename file and update constants

- [x] **Task 1: Rename file and update constant names**
  Files: `src/realtime/events/live.events.ts` → `src/realtime/events/module-session.events.ts`
  Rename the file from `live.events.ts` to `module-session.events.ts`. Inside it, rename the two exported constants:
  - `LIVE_SESSION_PAUSED` → `MODULE_SESSION_PAUSED` (value stays `'live_session.paused'` — or update to `'module_session.paused'` if event string values should match the new naming; milestone says rename constants, so update both name and value)
  - `LIVE_SESSION_UNPAUSED` → `MODULE_SESSION_UNPAUSED` (same approach for value)
  Delete the old `live.events.ts` file after creating the new one (or use `git mv`).

- [x] **Task 2: Update import and usages in activity-engine.service.ts** (depends on Task 1)
  Files: `src/realtime/services/activity-engine.service.ts`
  Update the import block (lines 12-15):
  - Change path from `'../events/live.events'` to `'../events/module-session.events'`
  - Change named imports from `LIVE_SESSION_PAUSED, LIVE_SESSION_UNPAUSED` to `MODULE_SESSION_PAUSED, MODULE_SESSION_UNPAUSED`
  Update both `eventEmitter.emit()` call sites:
  - Line 268: `this.eventEmitter.emit(LIVE_SESSION_PAUSED, ...)` → `this.eventEmitter.emit(MODULE_SESSION_PAUSED, ...)`
  - Line 300: `this.eventEmitter.emit(LIVE_SESSION_UNPAUSED, ...)` → `this.eventEmitter.emit(MODULE_SESSION_UNPAUSED, ...)`
