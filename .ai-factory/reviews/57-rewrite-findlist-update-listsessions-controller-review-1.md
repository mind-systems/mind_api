# Code Review: Rewrite `findList` + update `listSessions` controller

**Reviewed:** 2026-06-04
**Scope:** `breath-sessions.service.ts` (`findList` + `querySection` + cursor codec), `breath-sessions.grpc.controller.ts` (`listSessions`), `breath-sessions.service.spec.ts` (`findList` block).
**Verdict:** Implementation is correct against the spec note for the common case and the test suite is well-structured. Two real edge-case correctness issues and a couple of robustness nits below.

---

## Findings

### 1. [Medium] Sub-millisecond timestamp precision mismatch can silently skip rows at page boundaries

`breath-sessions.service.ts:187,244` — the cursor's `createdAt` is built from `row.createdAt.toISOString()`. The `createdAt` column is Postgres `TIMESTAMP` with default **microsecond** precision (`src/migrations/1774863293946-InitialSchema.ts:145`), but `node-postgres` parses `timestamp without time zone` into a JS `Date`, which only holds **milliseconds**. So the encoded cursor is millisecond-truncated, while the keyset predicate compares it against the full-precision column:

```ts
'(session."createdAt", session.id) < (:cursorCreatedAt, :cursorId)'
```

Concrete failure: boundary row `B` has DB `createdAt = …123456µs`; the cursor stores `…123000`. A not-yet-returned row `X` with `createdAt = …123300` legitimately belongs on the next page (it sorts after `B` in `createdAt DESC`). But the predicate evaluates `…123300 < …123000` → **false**, so `X` is permanently skipped — silent data loss across the page boundary.

This only triggers when two sessions share the same millisecond but differ in microseconds and the page boundary falls between them — uncommon for human-paced creation, but plausible for seeded/batch-inserted shared sessions, and the failure is silent.

**Fix options:**
- Truncate both sides to milliseconds so they're consistent — e.g. order by and compare against `date_trunc('milliseconds', session."createdAt")` (costs index usage on `createdAt`; acceptable at current scale), **or**
- Carry full precision in the cursor (select `to_char(session."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.US')` as a raw addSelect and compare against that string), **or**
- At minimum, document the "timestamps assumed unique to the millisecond" assumption in the cursor codec.

### 2. [Low] `pageSize` is unvalidated; `0` (the proto3 default) behaves inconsistently and can run unbounded

`pageSize` is a plain proto3 `int32` (`ListSessionsRequest`), so a client that omits it sends `0`. There is no validation/clamping in the controller or service.

- **Authenticated path:** `remaining = pageSize - collected.length` is `0` on the first iteration → `break` → returns `{ items: [], nextCursor: null }`.
- **Anonymous path:** `querySection(SHARED, null, keyset, 0)` calls `qb.take(0)`. In TypeORM 0.3.x, `take(0)` is falsy and **no `LIMIT` is emitted** → the query returns **all** shared sessions.

So the same `pageSize=0` yields an empty list for authenticated callers and an unbounded full-table scan for anonymous callers. Recommend clamping `pageSize` to a sane range (e.g. `1..100`) once at the top of `findList`, or rejecting `pageSize < 1` with `BadRequestException`. (The previous offset implementation shared the `take(0)` footgun, but the new code adds a path divergence worth closing.)

### 3. [Low / Nit] Keyset has no exactly-matching composite index

The ordering and predicate are on `(createdAt, id)`, but the existing indexes (`IDX_breath_sessions_userId_createdAt`, `IDX_breath_sessions_shared_createdAt`) cover `createdAt` only — `id` is not a trailing index column. Postgres can still use the index for the `createdAt` range and sort the (typically tiny) same-timestamp groups by `id`, so this is fine at current scale. Flagging only so it's on record if `breath_sessions` grows large; no action needed now. The plan's "no migration needed" claim holds for correctness.

### 4. [Nit] Extra empty query when a page ends exactly on an exhausted section boundary

When a cursor points at a section that is now fully consumed (e.g. page 1 returned exactly `pageSize` STARRED rows and STARRED had exactly that many), page 2 issues one `getMany()` that returns `[]` for the starting section before spilling into the next. Harmless and self-correcting (the loop continues with `keyset = null`); just an avoidable round-trip. Not worth changing.

---

## Verified correct

- **Section tagging & intentional duplication.** A starred-own session correctly appears in both STARRED (`isStarred` forced `true`) and MINE (`isStarred` from `settingsMap`), disambiguated by `section` — matches spec note lines 9/63. Duplicate ids in the `findByUserAndSessions(In(ids))` lookup are harmless.
- **Resumption invariant.** `nextCursor.section` = the furthest section reached, and resuming there is safe because earlier sections are always fully drained before a later-section cursor is emitted. Verified for STARRED/MINE/SHARED boundaries including the "starting section returns empty, spill to next" case.
- **Keyset scoping.** Only the starting section receives the decoded keyset; `keyset = null` after the first iteration makes subsequent sections unbounded. Confirmed by the `andWhere`-called / not-called assertions in the spec.
- **Anonymous handling.** SHARED-only, no `isStarred`, and a non-SHARED cursor section is rejected with `BadRequestException`.
- **Error mapping.** `decodeCursor` throws `BadRequestException` → HTTP 400 → `GrpcStatus.INVALID_ARGUMENT` via `GrpcExceptionFilter`; the service correctly avoids throwing `RpcException` directly (per project convention and the plan).
- **`decodeCursor` robustness.** Handles non-object JSON (`null`, numbers), invalid section values, unparseable dates, empty/missing id, and malformed base64url — all routed to `BadRequestException`. Covered by spec tests.
- **Controller.** Preserves `@GrpcOptionalAuth()` + `@Payload() request` + `@GrpcCurrentUser()` (project rule satisfied); maps `result.items` → `{ session, section }` and `nextCursor ?? undefined` correctly. The extra `section` field on the row passed to `toProtoBreathSessionWithStarredDto` is structurally ignored — fine.
- **Soft deletes.** `createQueryBuilder('session')` retains TypeORM's automatic `deletedAt IS NULL` filtering, consistent with the prior implementation.
- **Types.** Return shape and the `settingsMap` union (`Map<string, …> | Map<any, any>`) compile cleanly; `STARRED` innerJoin with `take()` is join-aware and counts sessions once (settings is unique per `(userId, sessionId)`).
- **Spec suite.** Mock call-counts line up with the loop's `createQueryBuilder` invocations in every case; assertions exercise first page, keyset second page, boundary spill, anonymous (+cursor +bad-section), empty, isStarred true/false/default, and both malformed-cursor paths.

---

## Recommendation

Findings #1 and #2 are the only ones worth acting on before merge — #1 for silent correctness under timestamp collisions, #2 for the unbounded anonymous query on `pageSize=0`. #3 and #4 are informational. None block the core logic, which is sound.
