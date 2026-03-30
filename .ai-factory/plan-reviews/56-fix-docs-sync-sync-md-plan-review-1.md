# Plan Review: Fix `docs/sync/sync.md`

**Plan file:** `.ai-factory/plans/56-fix-docs-sync-sync-md.md`
**Files reviewed:** plan + `docs/sync/sync.md`, `src/sync/sync.grpc.controller.ts`, `src/realtime/sync-stream.grpc.controller.ts`, `src/realtime/services/sync-stream.service.ts`, `proto/sync.proto`
**Risk Level:** 🟡 Medium

## Context Gates

- **ARCHITECTURE.md:** WARN — no conflicts; plan is a doc-only change.
- **RULES.md:** WARN — no code changes, rules about non-null assertions and logging are not applicable.
- **ROADMAP.md:** WARN — the roadmap entry for this task explicitly scopes only the push section and See Also links, but the plan's own context claims to "update the doc to match the current implementation." The REST section is equally stale and has no separate roadmap entry to cover it.

## Critical Issues

### 1. REST section (lines 22–54) is equally stale but not addressed

The plan fixes the push section (WebSocket → gRPC streaming) but leaves the "## REST — GET /sync/changes" section untouched. HTTP controllers were deleted in Phase 4.1. The `GET /sync/changes` endpoint no longer exists — it is now a gRPC unary `GetChanges` RPC handled by `SyncGrpcController` (`src/sync/sync.grpc.controller.ts`).

The request/response semantics are the same (after, limit → events/cursor/hasMore or fullResync), but the transport, heading, and client usage description are all wrong. This is the same category of staleness the plan fixes for the push section.

**What to add:** A new task between current Task 1 and Task 2 that rewrites the "## REST — GET /sync/changes" heading and description to describe the gRPC unary `GetChanges` RPC. The request/response tables can mostly stay (same fields), but the section heading, transport description, and "query parameters" framing need to change to gRPC request message fields.

### 2. Task 2 is incomplete — intro also mentions "REST-эндпоинта"

Task 2 updates line 5 to replace "WebSocket-push" with "gRPC-стрим". But the same sentence also says "REST-эндпоинта для опроса" — if the REST section is updated to gRPC (per issue #1), the intro must reflect that too. All three parts listed in the intro need updating:

Current: "журнала изменений в базе данных, REST-эндпоинта для опроса и WebSocket-push для мгновенного уведомления"
Should become something like: "журнала изменений в базе данных, gRPC-запроса для опроса и gRPC-стрима для мгновенного уведомления"

## Suggestions

### 3. Line 3 "[Back to README]" navigation link

Line 3 has `[Back to README](../../README.md)`. The global documentation rules prohibit prev/next navigation links. While "Back to README" is not strictly the `[← Previous]` / `[Next →]` pattern, it is header navigation clutter. Consider removing it as part of this cleanup pass — or at minimum, verify that neighboring docs have the same link to stay consistent before removing.

## Positive Notes

- All four tasks correctly identify real problems with accurate line references — verified against the current file.
- Task 1 thoroughly describes the replacement gRPC behavior: replay-then-live, `FAILED_PRECONDITION` on stale cursor, 300 ms debounce, full event data delivery. All confirmed accurate against `SyncStreamGrpcController` and `SyncStreamService`.
- Task 3 correctly identifies `SyncNotifierService` as removed and `SyncStreamService` as its replacement — confirmed, `SyncNotifierService` no longer exists.
- Task 4 correctly removes the See Also section with dead links — matches global documentation rules.
- The plan correctly specifies Russian as the document language, matching all neighboring docs in `docs/`.
