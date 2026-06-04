# Plan Review: Rewrite `findList` + update `listSessions` controller

**Plan:** `.ai-factory/plans/57-rewrite-findlist-update-listsessions-controller.md`
**Reviewed:** 2026-06-04
**Risk Level:** 🟢 Low — the approach is sound and grounded in the actual codebase; findings below are edge-case refinements, not architectural defects.

## Verification against the codebase

Confirmed the plan's assumptions hold:

- **Proto types** (`proto/generated/breath_sessions.ts`) match exactly: `SessionSection { STARRED=0, MINE=1, SHARED=2 }`, `SessionListItem { session, section }`, `ListSessionsRequest { cursor?, pageSize }`, `ListSessionsResponse { items, nextCursor? }`. No regeneration needed. ✓
- **Line ranges are accurate**: `findList` at 85–140, `listSessions` at 70–85, spec `describe('findList')` at 165–353. ✓
- **Only caller of `findList`** is `breath-sessions.grpc.controller.ts` + the spec — no REST/web consumer of the old `{ data, total, page, pageSize }` shape, and no e2e test references `listSessions`/`nextCursor`. The response-shape break is fully contained. ✓
- **No migration needed**: entity has `@Index(['userId','createdAt'])` and `@Index(['shared','createdAt'])`; `BreathSessionSettings` has `@Index(['userId','starred'])`. The three indexes the note names already exist. ✓
- **`BadRequestException` → `INVALID_ARGUMENT`**: confirmed `GrpcExceptionFilter` maps HTTP 400 → `GrpcStatus.INVALID_ARGUMENT`, so throwing `BadRequestException` from the service (not `RpcException`) is correct. ✓
- **`settingsService.findByUserAndSessions(userId, ids)`** exists and returns `Map<string, BreathSessionSettings>` — reuse is valid. ✓
- **`toProtoBreathSessionWithStarredDto`** reads `session.isStarred` and ignores extra fields, so passing `BreathSession & { isStarred, section }` works and `section` flows through untouched. ✓
- **Soft-delete**: `createQueryBuilder('session')` auto-applies `deletedAt IS NULL` (entity has `@DeleteDateColumn`), preserving the current behaviour. ✓

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md` present): WARN-free. Logic stays in `BreathSessionsService`, controller remains thin, cross-module data still comes via the exported `settingsService`. Module-level cursor helpers in the service file do not cross a module boundary.
- **Rules** (`.ai-factory/RULES.md` present):
  - *No non-null assertion (`!`)* — **applies to implementation.** When reading the last collected row for `nextCursor` (and anywhere a value could be undefined), the implementer must use an explicit guard, not `last!.createdAt`. Flag this in the task as a constraint.
  - *`@Payload()` mandatory with `@GrpcCurrentUser()`* — Task 3 explicitly preserves both. ✓
  - *Lean logging / no sensitive data* — plan sets logging to minimal; do not log cursor contents or user IDs beyond outcomes. ✓
- **Roadmap** (`.ai-factory/ROADMAP.md` present): `findList` cursor work is tracked (ROADMAP references it; notes 40/42 anchor the milestone). Linkage present — no WARN.
- **skill-context** (`.ai-factory/skill-context/aif-review/SKILL.md`): not present — no project-specific review overrides to apply.

## Findings

### Should address (non-blocking, but fix during implementation)

1. **`pageSize = 0` can crash `nextCursor` computation.**
   `pageSize` is a proto `int32` that defaults to `0` when a client omits it. With `pageSize = 0`: the spill loop computes `remaining = 0 - 0 = 0` and breaks immediately, so `collected = []`. The plan's `nextCursor` rule is "`collected.length < pageSize` → null, **else** encode from the last row." Here `0 < 0` is `false`, so it falls to the else branch and dereferences `last.createdAt` on an empty array → runtime crash. The old offset code returned an empty page harmlessly.
   **Fix:** treat `collected.length === 0` as `nextCursor = null` (and/or validate/clamp `pageSize >= 1`, throwing `BadRequestException` for non-positive values). Add a `pageSize = 0` case to the spec.

2. **Cursor `createdAt` precision vs. DB timestamp precision — potential silently-dropped rows.**
   The cursor stores `createdAt` as `row.createdAt.toISOString()` (millisecond precision — a JS `Date` cannot hold more). The DB `@CreateDateColumn` is a Postgres `timestamp` with microsecond resolution. The keyset predicate `(session."createdAt", session.id) < (:cursorCreatedAt, :cursorId)` then compares a microsecond-precision column against a millisecond-truncated bound. If a row's `createdAt` falls in the sub-millisecond gap between the truncated cursor value and the true boundary value, it is **excluded from the next page and never returned** — and the `id` tie-breaker does not rescue it, because the mismatch is on the `createdAt` component. Likelihood is low at this app's data scale (requires rows created within the same millisecond, e.g. bulk inserts/seeds), but it is a genuine keyset-pagination correctness hazard the plan/note do not mention.
   **Recommendation:** at minimum note the limitation; ideally compare against a millisecond-truncated expression on both sides, or persist/serialize the boundary at full precision. Decide explicitly rather than leaving it implicit.

### Minor / clarity

3. **`querySection` SHARED branch must handle `userId = null`.** Task 1 passes `userId` into `querySection` and parenthetically notes "for anonymous, just `session.shared = true`," but the signature implies a single code path. Make the SHARED branch conditional: omit the `session."userId" != :userId` clause (and the `:userId` param) when `userId === null`. STARRED/MINE are never reached for anonymous, so they need no null handling — but a stray `:userId` param with no matching placeholder would throw, so keep them out of the anonymous path entirely.

4. **Tag rows immutably.** When attaching `section`/`isStarred`, build new objects (`{ ...row, section, isStarred }`) rather than mutating the entities. Rows from STARRED and MINE are separate query results (separate object instances), so aliasing is not currently a risk, but spreading keeps it safe and matches the declared return type.

5. **Row-value parameter typing.** `(session."createdAt", session.id) < (:cursorCreatedAt, :cursorId)` relies on Postgres coercing untyped (text) bound params to `timestamp`/`uuid`. This generally works through TypeORM's parameter binding, but verify against a real DB during the manual verification step in the note — a type-resolution surprise here would surface only at runtime, not in the mocked unit tests.

## Positive notes

- Correctly identifies that a section is always fully drained before advancing (the loop only moves on when a section returns fewer than `remaining`), so resuming mid-section via the cursor keyset is consistent and disjoint — the core pagination invariant holds.
- Intentional cross-section duplication (starred-own appearing in both STARRED and MINE) is called out and justified; the `section` field disambiguates for the client.
- Plain `innerJoin`/`where` (not `...AndSelect`) means TypeORM `.take()` emits a direct `LIMIT` with no row-multiplication, so pagination counts stay correct.
- Test matrix in Task 4 is thorough: first page, cursor continuation, boundary spill, anonymous, empty, `isStarred` semantics, malformed cursor. Adding the `pageSize = 0` case (finding 1) would round it out.
- Dependencies between tasks are correctly ordered (codec → reader → controller → tests) and the controller/spec changes are scoped precisely to the only affected call sites.

## Verdict

The plan is implementable as written and architecturally correct. The two "should address" items (`pageSize = 0` crash; timestamp precision) are real but low-likelihood edge cases that the implementer can fold in without changing the plan's structure; the rest are clarifications. None rise to a blocking defect.

PLAN_REVIEW_PASS
