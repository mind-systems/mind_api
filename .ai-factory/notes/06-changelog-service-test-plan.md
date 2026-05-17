# ChangelogService — Test Plan

**Date:** 2026-05-17
**Source:** roadmap-test-coverage agent

## Source Overview

The `ChangeLogService` is a NestJS service that manages change event logging for auditing and real-time notification purposes. It tracks entity modifications (creation, updates, deletions) associated with users, providing methods to log single events, batch log for multiple recipients, retrieve changes with pagination/cursor support, and purge old records. The service uses TypeORM's `Repository` to interact with the `ChangeEvent` entity.

## Instantiation

```typescript
const module: TestingModule = await Test.createTestingModule({
  providers: [
    ChangeLogService,
    {
      provide: getRepositoryToken(ChangeEvent),
      useValue: {
        insert: jest.fn(),
        query: jest.fn(),
        createQueryBuilder: jest.fn(),
      },
    },
  ],
}).compile();
```

Mock `Repository<ChangeEvent>`: `insert()`, `query()`, and `createQueryBuilder()`. QueryBuilder methods must return `this` (`mockReturnThis()` pattern) to support chaining.

## Existing Coverage

None.

## Test Cases

### `log()`

- should insert a change event and return the generated ID when called with valid parameters
  - Setup: Mock `insert()` to return `{ identifiers: [{ id: 42 }] }`
  - Assert: Returns `42`; insert was called with `{ entity, refId, action, userId }`
- should handle numeric ID returned from the database
  - Setup: Mock insert returning `{ identifiers: [{ id: 999 }] }`
  - Assert: Returns `999` as a number
- should work with all ChangeEntity and ChangeAction enum values

### `logForRecipients()`

- should not execute any query when userIds array is empty
  - Assert: `query()` never called
- should insert change events for each recipient with correct SQL parameters
  - Setup: `userIds: ['user-1', 'user-2', 'user-3']`; verify SQL has 3 value blocks and params array has 12 elements
- should handle single recipient correctly (one value block, 4 params)
- should construct correct SQL for large recipient lists (100 users → 100 value blocks)

### `getChanges()`

- should return paginated results when rows exist
  - Assert: `{ events, cursor: lastId, hasMore: false }`
- should set cursor to last event ID when hasMore is false
- should indicate hasMore is true when rows exceed limit
  - Setup: Mock getMany returning `limit + 1` rows
  - Assert: `events.length === limit`, `hasMore === true`, `cursor === limit-th row id`
- should slice results to exact limit when hasMore is true
- should set cursor to afterId when no events are found
- should filter by userId and afterId in query
  - Assert: `.where('ce.userId = :userId')` and `.andWhere('ce.id > :afterId')` and `.limit(limit + 1)`
- should use default limit of 100 when not provided
- should order results by id ascending (`.orderBy('ce.id', 'ASC')`)

### `getMinEventId()`

- should return minimum id as integer when events exist
  - Setup: Mock `getRawOne()` returning `{ min: '42' }`; assert returns `42` (number, not string)
- should return null when `{ min: null }` returned
- should return null when result is undefined
- should parse string min value to integer correctly
- should select `MIN(ce.id)` with alias `min`

### `purge()`

- should delete change events older than specified days
  - Assert: where clause uses `make_interval(days => :days)` and logger prints "removed N"
- should use default of 30 days when olderThanDays not provided
- should log the count of affected rows
- should log zero affected rows when none deleted
- should log fallback count (0) when affected is undefined (`?? 0`)
- should use correct PostgreSQL `make_interval` syntax

## Gotchas

1. **Raw SQL parameter indexing in `logForRecipients()`** — positional params follow `$${i * 4 + N}` per user. Off-by-one errors cause silent SQL failures.
2. **`getMinEventId()` returns string from `getRawOne()`** — mock must return `{ min: "42" }` not `{ min: 42 }` to verify `parseInt` conversion.
3. **Cursor pagination fetches `limit + 1`** — when no events found, cursor defaults to `afterId`, not 0.
4. **Empty recipients early return** — `logForRecipients([])` must not call `query()` at all.
5. **TypeORM chainable QueryBuilder** — all builder methods must `mockReturnThis()`.
6. **`log()` accesses `result.identifiers[0].id`** — mock `insert()` to return exactly `{ identifiers: [{ id: N }] }`.
