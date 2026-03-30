## Plan Review Summary

**Plan:** Fix `docs/breath/breath-sessions.md`
**Files Affected:** 1
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** WARN — no issues; documentation-only change, no architectural concerns.
- **RULES.md:** WARN — no issues; no code changes, rules about `!` operator and logging are not applicable.
- **ROADMAP.md:** WARN — plan aligns with the unchecked Phase 12 item "Fix `docs/breath/breath-sessions.md`". Scope now covers all stale HTTP references in the file, not just the WebSocket line.

### Critical Issues

None. All four tasks verified against the codebase:

1. **Task 1 (lines 83–84)** — `CreateSession`, `UpdateSession`, `ReplaceSession` match the proto service definition (`proto/breath_sessions.proto` lines 181, 186–187) and the gRPC controller method names.

2. **Task 2 (line 101)** — All three RPCs accept `time_of_day` in their request messages: `CreateSessionRequest.time_of_day` (proto line 81), `UpdateSessionRequest.time_of_day` (proto line 93), `ReplaceSessionRequest.time_of_day` (proto line 104). Replacement is correct.

3. **Task 3 (lines 105–119)** — `BatchGetSessions` RPC exists (proto line 184). `BatchGetSessionsRequest` has `repeated string ids = 1` (proto line 163). Max 50 enforced in the gRPC controller (line 115). `@GrpcOptionalAuth()` decorator confirmed at controller line 110. Behavioral description about `isStarred` and silent skipping matches controller logic (lines 121–126, `BreathSessionWithStarredDto` response type).

4. **Task 4 (line 125)** — `WatchChanges` gRPC server-streaming RPC is documented in `docs/sync/sync.md` (line 56–57) and the replacement phrasing `gRPC-стрим WatchChanges` matches that doc's vocabulary exactly.

### Suggestions

None. The plan addresses all suggestions from review-1 — it now covers all stale HTTP-era references in the file (method names, batch endpoint, WebSocket push) in a single pass. Replacement text is in Russian, consistent with the existing doc language.

### Positive Notes

- Plan correctly incorporates all feedback from review-1, expanding from a single-line fix to a comprehensive four-task pass over the entire file.
- Each task references specific line numbers and exact code locations in the gRPC controller and proto file, making implementation unambiguous.
- Task 3's instruction to "keep the behavioral description unchanged" is a good guard — the `isStarred` and silent-skip behavior hasn't changed, only the transport layer.
- The plan correctly uses `@GrpcOptionalAuth()` (the actual decorator name) instead of the deleted `OptionalJwtAuthGuard`.

PLAN_REVIEW_PASS
