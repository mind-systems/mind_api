# Code Review (Pass 2): Rewrite `findList` + update `listSessions` controller

**Reviewed:** 2026-06-04
**Scope:** `breath-sessions.service.ts` (`findList` + `querySection` + cursor codec), `breath-sessions.grpc.controller.ts` (`listSessions`), `breath-sessions.service.spec.ts` (`findList` block).
**Context:** This pass reviews the revised implementation. The two findings from review-1 have been addressed — `date_trunc('milliseconds', …)` is now applied to **both** the keyset predicate and the ORDER BY (fixing the sub-millisecond skip), and a `pageSize < 1 → BadRequestException` guard runs ahead of both the anonymous and authenticated branches (fixing the `take(0)`/divergence issue). Both fixes are covered by new tests.

**Verdict:** Logic is correct and the suite is consistent with it. One environment-dependent correctness risk and one performance note remain; neither blocks merge.

---

## Findings

### 1. [Medium — environment-dependent] Keyset comparison round-trips a timestamp through JS and is only correct when Node TZ == Postgres TZ

`breath-sessions.service.ts:119` compares a DB-side value against a JS-derived cursor string:

```sql
(date_trunc('milliseconds', session."createdAt"), session.id) < (:cursorCreatedAt, :cursorId)
```

`:cursorCreatedAt` is produced by `row.createdAt.toISOString()` (`:195`, `:252`) — an ISO-8601 **UTC** string (`…Z`). The chain has two timezone-sensitive hops:

1. `createdAt` is `@CreateDateColumn()` → Postgres `TIMESTAMP` **without time zone** (`migrations/1774863293946-InitialSchema.ts:145`). `node-postgres` reconstructs the JS `Date` from a no-offset timestamp using the **Node process local timezone**.
2. When `:cursorCreatedAt` (e.g. `2026-03-01T00:00:00.000Z`) is bound for comparison against a `timestamp without time zone`, Postgres **ignores the `Z`** and takes the literal wall-clock, interpreted in the **Postgres session timezone**.

So the comparison is consistent only if the Node process TZ and the Postgres session TZ agree (both UTC). Under that assumption — the Docker default for both the node and postgres images, which is this project's deployment — it is correct. If they diverge, the cursor boundary is shifted by the offset, which can silently **skip or repeat a whole page** of rows.

This is a *newly introduced* sensitivity: the previous offset query used `createdAt` only in `ORDER BY` (DB-internal) and never round-tripped a timestamp back into a `WHERE`. Recommend one of:
- Document and pin `TZ=UTC` for the runtime and `timezone=UTC` for the DB session (lowest effort; matches current reality), **or**
- Migrate `createdAt` to `timestamptz` (robust, but a schema change — out of scope for this milestone), **or**
- Compare on a tz-invariant value (e.g. `EXTRACT(EPOCH FROM date_trunc('milliseconds', session."createdAt"))` against an epoch-ms number in the cursor).

If the team confirms UTC-everywhere is guaranteed and documented, this can be downgraded to a non-issue — flagging so the assumption is explicit rather than implicit.

### 2. [Low / Informational] `date_trunc` in ORDER BY/WHERE prevents index-assisted sorting

Wrapping `createdAt` in `date_trunc('milliseconds', …)` (`:119`, `:126`) is the correct fix for the precision bug, but it turns the sort key into a functional expression. The composite indexes (`userId, createdAt`), (`shared, createdAt`) and `IDX_breath_session_settings_userId_starred` still serve the **filter/equality and join** portions, so the candidate set is narrowed by index; only the final `ORDER BY` sort is no longer index-backed and runs in memory. Fine at current data volumes. If `breath_sessions` grows large, consider a functional index on `(date_trunc('milliseconds', "createdAt") DESC, id DESC)` (scoped per section). No action needed now.

---

## Verified correct (re-checked this pass)

- **Precision fix is internally consistent.** `nextCursor` encodes `row.createdAt.toISOString()` (JS Date is already ms-precision), and the predicate + ORDER BY both truncate the column to ms. Boundary row is excluded (not duplicated); within-ms rows fall back to a deterministic `id DESC` tiebreaker. With the same truncated ordering used on every page, no skip/dupe occurs within that ordering.
- **`pageSize` guard placement.** `if (pageSize < 1) throw BadRequestException` (`:172`) precedes both branches, so anonymous and authenticated paths are both protected. The old anonymous `take(0)` unbounded-scan path is gone. Covered by two tests (`:404`, `:408`).
- **Resumption invariant.** `nextCursor.section` is the furthest section reached; resuming there is safe because earlier sections are always fully drained before a later-section cursor is emitted (verified for STARRED→MINE→SHARED boundaries, including the "start section returns empty, spill onward" case where `keyset` is cleared after the first iteration).
- **Keyset scoping.** Only the starting section receives the decoded keyset; `keyset = null` after the first loop iteration. Spec asserts `andWhere` called on the MINE builder with `date_trunc`/`cursorId` and *not* called on the unbounded SHARED builder (`:270`, `:277`).
- **Section tagging & intentional duplication.** Starred-own session appears in both STARRED (`isStarred` forced `true`) and MINE (`isStarred` from `settingsMap`), disambiguated by `section`. Duplicate ids in the `In(ids)` settings lookup are harmless.
- **Anonymous handling.** SHARED-only, no `isStarred`, non-SHARED cursor section rejected with `BadRequestException` (`:330`).
- **Error mapping & codec robustness.** `decodeCursor` routes malformed base64url, non-object JSON, invalid section, unparseable `createdAt`, and empty/non-string `id` to `BadRequestException` → HTTP 400 → `INVALID_ARGUMENT` via `GrpcExceptionFilter`; the service avoids throwing `RpcException` directly, per convention. Covered by tests.
- **Controller.** Preserves `@GrpcOptionalAuth()` + `@Payload() request` + `@GrpcCurrentUser()` (project rule); maps `result.items` → `{ session, section }` and `nextCursor ?? undefined`. The extra `section` field on the row passed to `toProtoBreathSessionWithStarredDto` is structurally ignored. Drops the old `data/total/page/pageSize` correctly.
- **Soft deletes.** `createQueryBuilder('session')` retains TypeORM's automatic `deletedAt IS NULL` filter, consistent with the prior implementation.
- **Types.** Return shape and the `settingsMap` union (`Map<string, …> | Map<any, any>`) compile cleanly; `STARRED` innerJoin with `take()` is join-aware and counts each session once (settings unique per `(userId, sessionId)`).
- **Spec suite.** Mock `createQueryBuilder` call-counts align with the loop's invocations in every case; assertions now also pin the `date_trunc` ORDER BY/predicate and the `pageSize=0` rejections. No stale offset/`total`/`group_priority` assertions remain.

---

## Recommendation

Finding #1 is the only item worth a decision before merge, and it is environment-dependent: if UTC-everywhere is confirmed and documented for the runtime and DB, the implementation is correct as written. Finding #2 is informational. The core keyset/section logic is sound and the regressions from pass 1 are resolved.
