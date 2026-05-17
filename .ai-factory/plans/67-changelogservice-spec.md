# Test Plan: ChangelogService spec

## Context
The `ChangeLogService` in `src/changelog/changelog.service.ts` has no spec coverage. It manages change-event journaling for sync via a single injected `Repository<ChangeEvent>`. This plan covers all five public methods: `log()`, `logForRecipients()`, `getChanges()`, `getMinEventId()`, and `purge()`.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Test Command
`npx jest src/changelog/changelog.service.spec.ts`

## Target Spec File
`src/changelog/changelog.service.spec.ts`

## Tasks

### Phase 1: ChangeLogService — single-event logging

- [x] **Task 1: `log()`**
  Files: `src/changelog/changelog.service.spec.ts`
  Test cases:
  - `should return the generated id from result.identifiers[0].id when log is called`
  - `should call insert with { entity, refId, action, userId } when log is invoked`
  - `should propagate the numeric id type from insert result when identifiers id is a number`

### Phase 2: ChangeLogService — batch logging for recipients

- [x] **Task 2: `logForRecipients()`**
  Files: `src/changelog/changelog.service.spec.ts`
  Test cases:
  - `should not call repository.query when userIds array is empty`
  - `should build SQL with one value block ($1,$2,$3,$4) when a single recipient is provided`
  - `should build SQL with N value blocks when N recipients are provided`
  - `should produce a params array with exactly N×4 elements when N recipients are provided`
  - `should order params as [entity, refId, action, userId] per recipient preserving recipient order`
  - `should use positional placeholders following $((i*4)+1..4) pattern for each recipient`
  - `should target the "change_events" table in the INSERT statement`

### Phase 3: ChangeLogService — cursor-based change retrieval

- [x] **Task 3: `getChanges()` — query construction**
  Files: `src/changelog/changelog.service.spec.ts`
  Test cases:
  - `should call createQueryBuilder with alias 'ce' when getChanges is invoked`
  - `should apply where('ce.userId = :userId', { userId }) when filtering by user`
  - `should apply andWhere('ce.id > :afterId', { afterId }) when filtering by cursor`
  - `should call orderBy('ce.id', 'ASC') when assembling the query`
  - `should call limit(limit + 1) when limit is provided`
  - `should default limit to 100 when no limit argument is provided`

- [x] **Task 4: `getChanges()` — result shaping**
  Files: `src/changelog/changelog.service.spec.ts`
  Test cases:
  - `should return hasMore: false and full rows when getMany returns fewer rows than limit`
  - `should return hasMore: false and full rows when getMany returns exactly limit rows`
  - `should return hasMore: true and slice events to limit when getMany returns limit+1 rows`
  - `should set cursor to the id of the last returned event when events are present`
  - `should set cursor to afterId when getMany returns no rows`
  - `should set cursor to the limit-th row id (not the extra row id) when hasMore is true`

### Phase 4: ChangeLogService — minimum event id lookup

- [x] **Task 5: `getMinEventId()`**
  Files: `src/changelog/changelog.service.spec.ts`
  Test cases:
  - `should call createQueryBuilder with alias 'ce' and select('MIN(ce.id)', 'min') when invoked`
  - `should return 42 (number) when getRawOne returns { min: "42" }`
  - `should return null when getRawOne returns { min: null }`
  - `should return null when getRawOne returns undefined`
  - `should parse the string min value with parseInt base 10 when converting result`

### Phase 5: ChangeLogService — purge of old events

- [x] **Task 6: `purge()`**
  Files: `src/changelog/changelog.service.spec.ts`
  Test cases:
  - `should issue a delete query with where clause using make_interval(days => :days) when purge runs`
  - `should pass the olderThanDays value as the :days parameter when purge runs`
  - `should default olderThanDays to 30 when no argument is provided`
  - `should log "removed N change events older than D days" with the affected count when execute returns { affected: N }`
  - `should log a count of 0 when execute returns { affected: undefined } (?? 0 fallback)`
  - `should log a count of 0 when execute returns { affected: 0 }`
