# Plan Review (v2): GET /sessions/runs/:id/biometrics and GET /sessions/runs/:id/instructions

**Plan:** `.ai-factory/plans/28-get-sessions-runs-id-biometrics-and-get-sessions-runs-id-instructions.md`
**Risk Level:** 🟡 Medium — one residual correctness issue in the `flushedAt` coarse filter and a silent-truncation edge case in the row-cap; everything else from review-1 is resolved.

## Context Gates

- **ARCHITECTURE.md:** OK — the plan registers two more realtime-owned entities in `SessionsModule` via `TypeOrmModule.forFeature([...])`. The existing comment in `sessions.module.ts` (lines 4-7) explicitly sanctions this pattern for read-only consumers; the plan extends the same exception consistently. No new boundary is crossed.
- **RULES.md:** OK — no `!` assertions, no logging of sensitive payload contents, `Settings.Logging: minimal` matches the "keep logs lean" rule. No gRPC involvement, so the `@Payload()` rule is not in scope.
- **ROADMAP.md:** WARN — the task is referenced by orchestrator id `28` in the plan filename, which is the project's standard linkage. No explicit roadmap entry was located, but the orchestrator-task id is acceptable per existing convention.

## Resolution of Review 1 Findings

| Review 1 Finding | Status in v2 |
|---|---|
| #1 Controller args swapped (critical) | ✅ Fixed. Design Decision #1 sets `(userId, sessionId, from?, to?)` to match `listRuns`. Tasks 4-7 are internally consistent: service signatures and controller call sites both use `(user.sub, id, query.from, query.to)`. `assertSessionOwnership(userId, sessionId)` ordering matches. |
| #2 Inconsistent boundary inclusivity | ✅ Fixed. Design Decision #2 picks `[from, to)` and Task 4 applies it uniformly across all three branches via `And(MoreThanOrEqual, LessThan)`. |
| #3 `flushedAt` vs per-sample `timestamp` | ⚠️ Partially fixed — see Issue 1 below. Post-filter on per-sample `timestamp` is added (good), but the coarse `flushedAt` filter still drops valid samples on the upper edge. |
| #4 No upper bound on response size | ✅ Addressed. Design Decision #4 caps the flat array at 50k with `PayloadTooLargeException`, plus a `take: 5000` cap on the batch query. (See Issue 2 — the row cap can silently truncate.) |
| #5 Rename `repo` → `moduleSessionRepo` made explicit | ✅ Fixed. Task 3 spells out the constructor signature change and the `this.repo.findAndCount` → `this.moduleSessionRepo.findAndCount` update, with a grep-verification step. |
| #6 Sort after flatten | ✅ Fixed. Task 4 sorts `flat` by per-sample `timestamp` after flattening; string-compare on ISO 8601 is documented as safe. (See Issue 3 — caveat for mixed offsets.) |
| #7 Imports in controller | ✅ Fixed. Task 5 explicitly notes `Param`, `ParseUUIDPipe` are added to `@nestjs/common` and that `Query` is already imported. Task 7 reuses the same imports. |

## Critical Issues

(none)

## Issues

### 1. The `flushedAt` upper-bound filter still over-excludes right-edge samples ⚠️

Design Decision #3 says `flushedAt` is the "coarse filter (selects overlapping batch rows)" and that the per-sample `timestamp` post-filter is the authoritative window. But the coarse filter as written is not actually overlapping — it's a strict subset of `[from, to)`:

```ts
where.flushedAt = And(MoreThanOrEqual(fromDate), LessThan(toDate));
```

A batch is flushed *after* its samples are collected, so `sample.timestamp <= flushedAt`. Consider:
- User requests window `[10:00:00, 10:00:30)`.
- A batch with `flushedAt = 10:00:33` contains samples with timestamps `10:00:28`, `10:00:29`, `10:00:30`, `10:00:31`.
- Samples at `10:00:28` and `10:00:29` are inside the requested window, but the coarse filter drops the whole row because `flushedAt 10:00:33` is not `< 10:00:30`.

This is exactly the right-edge jitter that review 1's Issue #3 warned about, in a slightly different form. The lower bound is fine — if `flushedAt < from`, every sample in the batch has `ts <= flushedAt < from`, so the whole batch is correctly excluded. The upper bound is the problem.

Three options, pick one:

- **(a) Drop the upper coarse bound entirely** — query `flushedAt >= fromDate` and let the per-sample filter do all upper-bound work. Simplest, slightly more DB rows scanned at the right edge of the window.
- **(b) Pad the upper coarse bound by a known flush interval** — e.g. `flushedAt < toDate + WS_BIO_FLUSH_INTERVAL_MS`. Requires reading the flush-interval config; couples this read-side module to a write-side config knob.
- **(c) Document the limitation explicitly** — accept that the API trims the right edge by up to one flush interval, and tell the dashboard to over-request by that margin. Cheap, but the API contract becomes fuzzy and the design decision's claim that the per-sample timestamp is "authoritative" stops being true.

Recommendation: option (a). It's the simplest fix and keeps the API contract honest. The per-sample filter is already doing the precise work, and the existing `take: 5000` cap (plus the 50k flatten cap) still bounds DB and memory.

### 2. `take: 5000` can silently truncate without firing `PayloadTooLargeException`

Design Decision #4 argues that "5000 batches × typical samples-per-batch comfortably exceeds the 50k flatten cap, so the flatten cap is what actually fires first." That holds **only when avg samples-per-batch > 10**. For low-rate streams (e.g. one sample per flushed batch, or an instructions stream where events are sparse), 5000 batches yields ≤ 5000 samples — well under the flatten cap — and the user gets a silently truncated response with no indication that data was dropped.

Two practical fixes:

- Make `take = 50_001` (or whatever value safely exceeds the flatten cap) so that, in the bad case, the loop hits the 50k flatten threshold and throws. Then the row cap stops being a silent truncator.
- Or sort batches `ASC` and add an end-of-loop check: if `rows.length === take`, throw `PayloadTooLargeException` with the same message. Communicates the overflow regardless of samples-per-batch.

Either is fine. The current `take: 5000` value is the only one likely to fail closed.

### 3. ISO 8601 string-compare for sort is safe only if all timestamps share the same offset

Task 4's post-flatten sort uses `String(a['timestamp']).localeCompare(String(b['timestamp']))` and calls out "String compare is safe for ISO 8601 timestamps." That is true only when all timestamps use the same offset representation — `2026-05-30T10:00:00Z` and `2026-05-30T12:00:00+02:00` represent the same instant but compare as different strings, with the `+02:00` value sorting later. If the write-side normalizes everything to `Z`-suffix (UTC), this is fine.

Action: either confirm the write path normalizes timestamps to UTC `Z` (check `BiometricStreamEngine` / wherever samples are appended to the batch buffer) and add a one-line comment in Task 4 stating the assumption, or sort by `new Date(...).getTime()` to make the sort instant-correct regardless of representation. The `Date(...).getTime()` form is one extra parse per element but is unambiguously correct.

### 4. Ownership check accepts in-flight sessions; `listRuns` does not

`listRuns` filters `where: { userId, endedAt: Not(IsNull()) }` — it only surfaces completed runs. `assertSessionOwnership` as proposed in Task 3 accepts any `module_session` row with a matching `id` regardless of `endedAt` or `status`. That means a client that knows (or guesses) the UUID of an *active* session can fetch its in-flight biometrics/instructions even though that session is not yet visible via `GET /sessions/runs`. UUIDs are not guessable in practice, so this isn't a security hole, but it is an inconsistency with the rest of the module's "completed runs only" contract.

Two options, pick one and document it:
- **Intentional:** if mid-session reads are part of the dashboard flow, leave as-is and add a one-line plan note ("biometrics/instructions are queryable while the session is still active; this is intentional").
- **Restrict:** add `endedAt: Not(IsNull())` to the `assertSessionOwnership` lookup so the new endpoints match `listRuns`'s behaviour exactly.

### 5. Sample envelope shape is asserted but not verified against the write path

Task 4 / Task 6 state the elements look like `{ timestamp, sampleType, data }` and `{ timestamp, type, payload }`. The plan does not include a verification step that the write paths (`BiometricStreamEngine`, `StreamEngine` / `ModuleStateService`) actually push exactly these shapes into the jsonb arrays. If the write path stores `timestamp` as a `Date` object that's serialized differently — or under a key like `t` instead of `timestamp` — both the per-sample filter and the post-sort silently degrade to no-ops (the `typeof ts === 'string'` guard skips filtering; the sort treats every entry as equal). Recommend a quick read of the relevant write-path code (or a short integration check at implementation time) before locking in the `'timestamp'` key.

## Minor / Style

- The optional refactor note at the end of Task 6 (extract a `listSamples<T>` helper) is fine to leave to the implementer's judgement. The duplication is small enough that either choice is defensible.
- The 50k cap comparison `if (flat.length > 50_000)` allows a flat array of length 50_001 before throwing. Off-by-one but harmless; consider `>= 50_000` for exactness if you care.
- Task 1 says "Extend the comment if needed to mention that these two entities are also read-only consumers." Good — please do extend the comment; future maintainers will need it for the same reason `ModuleSession` needed it.

## Positive Notes

- The design-decisions block at the top of the plan is genuinely useful — it pins down the four ambiguities flagged in review 1 in one place, and Tasks 4/6 reference it consistently.
- Argument-order convention (matching `listRuns(userId, ...)`) is the right call; it eliminates the entire class of mistakes that flagged review 1.
- The 50k flatten cap + `PayloadTooLargeException` choice is the right NestJS idiom for this; it surfaces cleanly to the dashboard as a 413.
- The plan correctly identifies that the per-sample `timestamp` is the authoritative filter and explicitly comments it in the code. The remaining issue (#1 above) is in how the coarse filter is bounded, not in the principle.
- The grep-verification step for the `this.repo` → `this.moduleSessionRepo` rename in Task 3 is a nice touch.

## Required Changes Before Implementation

1. **Fix the `flushedAt` upper-bound coarse filter** (Issue 1) — drop the upper bound, or pad it by the flush interval, or document the right-edge trim. Recommend dropping it.
2. **Make the row cap fail loudly or raise it above the flatten cap** (Issue 2) — either set `take` above 50_000 so the flatten cap is guaranteed to fire first, or add an explicit `rows.length === take` overflow check.
3. **Confirm timestamp normalization and either document the assumption or switch the sort comparator to `new Date(...).getTime()`** (Issue 3).
4. **Decide whether in-flight sessions are queryable** (Issue 4) and document the choice; if not, add `endedAt: Not(IsNull())` to the ownership lookup.
5. **Verify the jsonb element shape against the write path** (Issue 5) — quick sanity check on the `'timestamp'` key before implementing.

Once these are addressed the plan is implementable end-to-end.
