# Test Plan: SyncService spec

## Context
`SyncService` (`src/sync/sync.service.ts`) is a thin facade over `ChangeLogService` that exposes paginated change retrieval with full-resync detection and a daily purge job. No spec exists today — this plan creates one covering both methods including the early-return branches and the event-field filtering.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/sync/sync.service.spec.ts`

## Target Spec File
`src/sync/sync.service.spec.ts`

## Tasks

### Phase 1: SyncService — `getChanges()` happy path

- [x] **Task 1: `getChanges()` returns filtered events, cursor and `hasMore` from ChangeLogService**
  Files: `src/sync/sync.service.spec.ts`
  Test cases:
  - `should return events, cursor and hasMore from changeLogService when changes exist`
  - `should set hasMore=true when changeLogService returns a result with hasMore=true (limit+1 underlying rows)`
  - `should set hasMore=false when changeLogService returns a result with hasMore=false`
  - `should pass userId, afterId and limit through to changeLogService.getChanges unchanged`

- [x] **Task 2: `getChanges()` empty result behavior**
  Files: `src/sync/sync.service.spec.ts`
  Test cases:
  - `should return an empty events array when changeLogService returns no events`
  - `should preserve afterId as the cursor when changeLogService returns no events (cursor must not collapse to 0)`
  - `should report hasMore=false when no events are returned`

### Phase 2: SyncService — full-resync branching in `getChanges()`

- [x] **Task 3: Full-resync trigger when cursor is older than min event id**
  Files: `src/sync/sync.service.spec.ts`
  Test cases:
  - `should return { fullResync: true } when afterId < minEventId and afterId !== 0 and minEventId !== null`
  - `should not call changeLogService.getChanges() when the full-resync branch is taken`
  - `should call changeLogService.getMinEventId() exactly once on the full-resync path`

- [x] **Task 4: Full-resync is not triggered for sentinel/edge inputs**
  Files: `src/sync/sync.service.spec.ts`
  Test cases:
  - `should not trigger full-resync when afterId === 0 even if minEventId is greater than 0 (sentinel "start from beginning")`
  - `should not trigger full-resync when minEventId === null (empty changelog)`
  - `should not trigger full-resync when afterId >= minEventId`
  - `should call changeLogService.getChanges() in each of the non-full-resync edge cases`

### Phase 3: SyncService — event field projection

- [x] **Task 5: Output events contain only the public fields**
  Files: `src/sync/sync.service.spec.ts`
  Test cases:
  - `should map each event to exactly { id, entity, refId, action, createdAt } when underlying events carry extra fields like userId`
  - `should not include userId on any returned event`
  - `should preserve the order of events as returned by changeLogService`
  - `should forward the cursor and hasMore from changeLogService unchanged alongside the projected events`

### Phase 4: SyncService — `purgeOldEvents()`

- [x] **Task 6: Daily purge delegates to ChangeLogService**
  Files: `src/sync/sync.service.spec.ts`
  Test cases:
  - `should call changeLogService.purge() with no arguments when purgeOldEvents() is invoked`
  - `should resolve without throwing when changeLogService.purge() resolves`
  - `should propagate the rejection when changeLogService.purge() rejects (no silent swallow)`
