# Plan Review (v3): GET /sessions/runs/:id/biometrics and GET /sessions/runs/:id/instructions

**Plan:** `.ai-factory/plans/28-get-sessions-runs-id-biometrics-and-get-sessions-runs-id-instructions.md`
**Risk Level:** 🟢 Low — every required change from plan-review-2 is addressed and verified against the codebase.

## Context Gates

- **ARCHITECTURE.md:** OK — the modular monolith rule "entities stay in their module" is respected via the documented read-only consumer exception already established for `ModuleSession` in `sessions.module.ts`. Task 1 extends the existing comment to cover the two added entities, so the precedent is consistent and explicit. No new boundary is crossed.
- **RULES.md:** OK — no `!` assertions are introduced, no sensitive data is logged (Settings: Logging minimal, no log lines in the code samples), and the endpoints are REST (not gRPC) so the `@Payload()` rule is not in scope.
- **ROADMAP.md:** WARN — no explicit entry in `Phase 19` for the dashboard read endpoints; orchestrator task-id linkage via filename `28-...` is the project convention and is sufficient.

## Resolution of Review 2 Findings

| Review 2 Finding | Status in v3 |
|---|---|
| #1 `flushedAt` upper bound over-excludes right-edge samples (critical) | ✅ Fixed. Design Decision #3 and Task 4 explicitly drop the upper coarse bound — only `flushedAt >= fromDate` is applied. The per-sample numeric `timestamp` post-filter is the sole authority on the upper bound. |
| #2 `take: 5000` could silently truncate for sparse streams | ✅ Fixed. ROW_CAP raised to 60_000 (above the 50_000 flatten cap, so flatten throws first for dense streams) **and** an explicit `rows.length === ROW_CAP` check throws `PayloadTooLargeException` for sparse streams. Belt-and-suspenders — neither can silently truncate. |
| #3 ISO string sort comparator unsafe for mixed offsets | ✅ Fixed. The plan re-verified the write-path shape and confirmed `timestamp` is **numeric unix-ms**, not an ISO string. Sort comparator is `(a, b) => Number(a['timestamp']) - Number(b['timestamp'])`. The whole class of timezone-string concerns is gone. |
| #4 In-flight sessions queryable but `listRuns` excludes them | ✅ Resolved. Design Decision #6 picks "intentional" and adds a code comment in `assertSessionOwnership` documenting why no `endedAt` filter is applied (the dashboard's live-session view depends on it). |
| #5 Sample envelope shape not verified against write path | ✅ Fixed. The "Verified write-path shapes" section at the top of the plan reads both `bio-session-buffer.interface.ts` and `session-buffer.interface.ts` and pins down the actual shapes. The plan even corrects the spec's `{timestamp, type, payload}` to the actual `{timestamp, data}` for instruction samples, and notes the service must pass the jsonb element through verbatim. |

## Critical Issues

(none)

## Issues

(none)

## Minor / Style

- **`from > to` is not validated.** `TimeRangeQueryDto` accepts any pair of ISO 8601 strings; if a client sends `from` later than `to`, both filters apply and the response is silently empty. Not a correctness bug, but a 400 response would be friendlier to dashboard developers. Optional — add a `@ValidateIf`-style cross-field check if/when needed.
- **Composite index opportunity.** Both `bio_session_samples` and `session_stream_samples` only have a single-column index on `moduleSessionId`. The new `where { moduleSessionId, flushedAt >= fromDate }` lookup with `order: { flushedAt: 'ASC' }` could benefit from a composite `(moduleSessionId, flushedAt)` index later, but the row cap and per-session scope keep cost bounded for now. Worth a roadmap note rather than a blocker for this plan.
- **Optional helper extraction.** Task 6 acknowledges the duplication between `listBiometrics` and `listInstructions` and offers a `private listSamples<T>` helper. Either choice is acceptable for two call sites; leaving it to implementer judgement is fine.
- **`samples ?? []`** defensive fallback is paired with `samples: jsonb NOT NULL` in the entities — harmless overkill but improves resilience to old/corrupt rows.

## Positive Notes

- The "Verified write-path shapes" preamble is a strong improvement over v2 — it grounds the whole filter/sort design in the actual on-disk shape rather than a spec assumption, and surfaces a real spec/code discrepancy (`{timestamp, type, payload}` vs `{timestamp, data}`) that would otherwise have produced a silently broken filter.
- Promoting the numeric-timestamp insight from a comment to a Design Decision (#7) eliminates the entire timezone-string-compare concern that review 2 flagged.
- The ROW_CAP design — set above FLAT_CAP so the flatten check throws first, **plus** an explicit equality check on row count — defends against both dense and sparse streams without relying on assumptions about samples-per-batch.
- The Design Decisions block at the top of the plan continues to pay dividends: every "why" needed downstream is anchored in one place, and Tasks 3-7 reference the relevant decisions by number.
- Argument-order convention `(userId, sessionId, from?, to?)` is consistent across the service surface and matches the existing `listRuns(userId, ...)` shape; the controller call sites mirror it.
- The grep-verification step for the `this.repo` → `this.moduleSessionRepo` rename in Task 3 is a nice defensive touch that survives v3.
- The explicit one-line comment in `assertSessionOwnership` about why in-flight sessions are queryable is precisely the future-maintainer note that prevents this from being "fixed" by someone who notices the inconsistency with `listRuns`.

PLAN_REVIEW_PASS
