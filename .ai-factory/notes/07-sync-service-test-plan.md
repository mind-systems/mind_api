# SyncService — Test Plan

**Date:** 2026-05-17
**Source:** roadmap-test-coverage agent

## Source Overview

`SyncService` is a lightweight synchronization service that exposes two operations: `getChanges()` which retrieves paginated change events for a user with full-resync detection, and `purgeOldEvents()` which runs daily at midnight to delete changelog entries older than 30 days. The service acts as a facade over `ChangeLogService`, filtering and transforming event data for consumption by clients.

## Instantiation

```typescript
const module: TestingModule = await Test.createTestingModule({
  providers: [
    SyncService,
    {
      provide: ChangeLogService,
      useValue: {
        getMinEventId: jest.fn(),
        getChanges: jest.fn(),
        purge: jest.fn(),
      },
    },
  ],
}).compile();
const service = module.get<SyncService>(SyncService);
```

`@Cron` decorators do not execute during unit tests — call `purgeOldEvents()` directly.

## Existing Coverage

None.

## Test Cases

### `getChanges()` — happy path

- should return filtered events and cursor when changes exist
  - Setup: `minEventId=100`, `afterId=150`, changelog returns 3 events with ids [151,152,153]
  - Assert: result has exactly those 3 events (id, entity, refId, action, createdAt), `cursor=153`, `hasMore=false`
- should set `hasMore=true` when changelog returns `limit+1` rows
- should set `hasMore=false` when rows ≤ limit
- should return correct cursor when no events match
  - Assert: `cursor=afterId` (not 0 or undefined)

### `getChanges()` — full resync trigger

- should return `{ fullResync: true }` when `afterId < minEventId` and `minEventId !== null`
  - Assert: `changeLogService.getChanges()` is NOT called
- should NOT trigger resync when `afterId === 0` even if `afterId < minEventId`
  - `afterId=0` is a sentinel for "start from beginning"; condition is `afterId !== 0 && afterId < minEventId`
- should proceed normally when `minEventId === null`
- should NOT trigger resync when `afterId >= minEventId`

### `getChanges()` — data transformation

- should map each event to `{ id, entity, refId, action, createdAt }` (no userId or extra fields)
- should preserve event order from ChangeLogService

### `purgeOldEvents()`

- should call `changeLogService.purge()` (default 30 days)
- should not throw if purge succeeds
- should propagate errors from purge — no silent swallow

## Gotchas

1. **Early return on full resync** — `getChanges()` returns `{ fullResync: true }` immediately; `changeLogService.getChanges()` must not be called. Test both paths.
2. **`afterId=0` is a sentinel** — never triggers full resync regardless of `minEventId`.
3. **Event re-mapping strips userId and extra fields** — mock changelog must return objects with those fields to verify they're stripped.
4. **Cursor stays as `afterId` when empty** — do not let cursor collapse to 0.
5. **`@Cron` does not run in unit tests** — call `purgeOldEvents()` directly.
6. **No error handling** — exceptions from `ChangeLogService` propagate unchanged.
7. **Return type is a union** — `SyncChangesResult | { fullResync: true }`. Test both shapes.
