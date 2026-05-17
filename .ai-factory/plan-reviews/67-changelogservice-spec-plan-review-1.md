# Plan Review: 67-changelogservice-spec

**Plan file:** `.ai-factory/plans/67-changelogservice-spec.md`
**Target:** `src/changelog/changelog.service.spec.ts` (new file)
**Subject under test:** `src/changelog/changelog.service.ts` — `ChangeLogService`

## Risk Level
🟢 Low

## Context Gates

- **ARCHITECTURE.md:** Not directly applicable — spec-only plan, no module/dependency surface changes. PASS.
- **RULES.md:** No conflicts. Rules forbid `!` non-null assertions and sensitive-data logging; neither is relevant to a spec for a journaling service with no PII. PASS.
- **ROADMAP.md:** Spec-coverage work is appropriate as a quality task and is consistent with the existing pattern of `*.service.spec.ts` files across the codebase (sync, breath-sessions, users, realtime…). PASS.
- **CLAUDE.md (mind_api):** Test command matches conventions (`npx jest <path>`). PASS.

## Correctness of Assumptions Against Source

Verified the plan against the actual implementation in `src/changelog/changelog.service.ts` and the entity in `src/changelog/entities/change-event.entity.ts`.

- `log()` — Plan's expectations match the code (`insert({entity, refId, action, userId})` and `result.identifiers[0].id as number`). ✅
- `logForRecipients()` — Plan correctly captures the empty-array short-circuit, the `($1,$2,$3,$4)` placeholder pattern (`$((i*4)+1..4)`), N×4 params, ordering, and the `"change_events"` table name. ✅
- `getChanges()` — Plan correctly captures alias `'ce'`, both `where`/`andWhere` clauses, `orderBy('ce.id','ASC')`, `limit(limit+1)`, the default `limit=100`, and the result-shaping invariants (hasMore from `rows.length > limit`, slicing, cursor fallback to `afterId`). ✅
- `getMinEventId()` — Plan correctly captures `createQueryBuilder('ce').select('MIN(ce.id)', 'min').getRawOne()` and the `parseInt(..., 10)` conversion with null/undefined handling. ✅
- `purge()` — Plan correctly captures the `make_interval(days => :days)` where clause, default `olderThanDays=30`, and the `result.affected ?? 0` fallback in the log message. ✅

## Findings

### Minor — Test-name string does not include the actual log prefix
Task 6 (`purge()`) says:
> `should log "removed N change events older than D days" …`

The actual log line in `changelog.service.ts:101–103` is:
```ts
`purge: removed ${result.affected ?? 0} change events older than ${olderThanDays} days`
```
i.e. it has a `purge: ` prefix. The implementation-bound assertion should match the real string (or use a substring/regex). This is a wording issue in the plan, not a defect — the implementer just needs to assert against the prefixed string.

### Minor — Logger verification mechanism not specified
Task 6 expects assertions on `logger.log(...)`. `ChangeLogService` uses a class-scoped `private readonly logger = new Logger(ChangeLogService.name)`, so it is not injected and must be spied via `jest.spyOn(Logger.prototype, 'log')` (or assigning `(service as any).logger`). The plan does not name this strategy; spec author should pick one. Not blocking — common convention in the repo.

### Minor — `purge()` uses `createQueryBuilder()` without alias
`purge()` calls `this.changeEventRepo.createQueryBuilder().delete()...` (no alias), whereas `getChanges()` and `getMinEventId()` pass `'ce'`. Task 6 currently does not check the no-alias call, but Task 3 and Task 5 do check the alias. If the spec is going to assert on `createQueryBuilder`, Task 6 should explicitly accept "called with no alias" (or simply call `createQueryBuilder` with `undefined`). A small clarification, not a flaw.

### Minor — `logForRecipients()` SQL identifier-quoting assertion
Task 2 says `should target the "change_events" table in the INSERT statement`. The implementation uses double-quoted identifiers for table and all columns (`"change_events"`, `"entity"`, `"refId"`, `"action"`, `"userId"`). Plan should either explicitly tolerate the exact-quoting form or assert via a regex (`/INSERT INTO "change_events"/`). Worth calling out so the assertion isn't too loose (e.g., a non-quoted form would pass `toContain('change_events')`).

### Positive Notes

- Six tasks map cleanly to the five public methods, with `getChanges()` split into query-construction vs. result-shaping — a sensible separation.
- Edge cases for `getChanges()` cursor (empty result → `afterId`, exact-limit boundary, limit+1 boundary) are covered thoroughly.
- `getMinEventId()` null/undefined/string-coercion cases are well covered.
- `logForRecipients()` placeholder math is tested both as pattern (`$((i*4)+1..4)`) and as length (N×4) — guards against the most common bug class for this kind of hand-built SQL.
- Plan correctly identifies that empty-array input must short-circuit (no `repository.query`).

## Suggested (Optional) Additions

These are nice-to-have, not blockers:

- A `log()` test verifying that `insert` is called **exactly once** per invocation (prevents accidental duplicate writes if future refactor introduces logging hooks).
- A `logForRecipients()` test for `N=0` already exists; consider also asserting `repository.query` was **not** called (rather than just "did not throw").
- A `getChanges()` test confirming the same QueryBuilder instance is returned through the chain (i.e., chainable mocks return `this`) — this is more of a test-setup convention than a behavior.

None of these are required for `PLAN_REVIEW_PASS`.

## Verdict

The plan is accurate, covers all five public methods, and aligns with both `RULES.md` and the existing spec conventions in the repository. The findings above are wording/clarification nits rather than defects in the plan's structure or assumptions.

PLAN_REVIEW_PASS
