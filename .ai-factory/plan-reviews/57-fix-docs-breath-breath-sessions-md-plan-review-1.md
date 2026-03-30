## Plan Review Summary

**Plan:** Fix `docs/breath/breath-sessions.md`
**Files Affected:** 1
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** WARN — no issues; documentation-only change, no architectural concerns.
- **RULES.md:** WARN — no issues; no code changes, rules about `!` operator and logging are not applicable.
- **ROADMAP.md:** WARN — plan aligns with the unchecked Phase 12 item "Fix `docs/breath/breath-sessions.md`". Scope matches the roadmap description.

### Critical Issues

None. The stated change is correct:

- Line 125 does reference the stale `WebSocket-push `sync:changed`` terminology.
- The sync doc (`docs/sync/sync.md`) already describes gRPC server-streaming `WatchChanges` as the push mechanism.
- The proposed replacement text (`gRPC-стрим `WatchChanges``) matches the sync doc's vocabulary and is written in Russian, consistent with the rest of the file.
- The plan correctly preserves the link to `../sync/sync.md`.

### Suggestions

**The same file has more stale HTTP references that should be fixed in this pass.** The plan only addresses line 125, but since it's titled "Fix `docs/breath/breath-sessions.md`" and the file is being touched anyway, the remaining stale references should be cleaned up to avoid a dedicated follow-up task:

1. **Lines 83–84 — HTTP method names → gRPC RPC names.**
   Current text references `POST`, `PATCH`, `PUT`. HTTP controllers were deleted in Phase 4.1. These should reference gRPC operations (`CreateSession`, `UpdateSession`/`ReplaceSession`). Example:
   ```
   - При **создании** сессии (`CreateSession`)
   - При **обновлении** сессии (`UpdateSession`, `ReplaceSession`) — пересчитывается, если изменились `exercises`
   ```

2. **Lines 105–119 — `GET /breath-sessions/batch` section → `BatchGetSessions` RPC.**
   The entire "Пакетная загрузка" section describes an HTTP endpoint with query-string `ids` parameter. The actual implementation is now the `BatchGetSessions` gRPC RPC in `breath-sessions.grpc.controller.ts`. The section should be rewritten for gRPC: request message field `ids` (repeated string, max 50) instead of comma-separated query parameter; remove the `GET /breath-sessions/batch?ids=...` URL example; replace `OptionalJwtAuthGuard` mention with `@GrpcOptionalAuth` (which is how optional auth is applied in the gRPC controller).

3. **Line 116 — dead HTTP URL example.**
   `GET /breath-sessions/batch?ids=uuid1,uuid2,uuid3` no longer exists. Should show the gRPC request shape instead.

These are all in the same doc, same category of staleness (HTTP → gRPC migration), and trivial to fix alongside the WebSocket reference. Leaving them creates an inconsistent document where the last paragraph is updated but the rest still talks HTTP.

### Positive Notes

- Clear, minimal scope — the plan correctly identifies the exact line and the exact replacement text.
- The proposed replacement mirrors the sync doc's terminology (`gRPC-стрим `WatchChanges``) rather than inventing new phrasing.
- The "keep the rest of the sentence and the link unchanged" instruction is a good guard against accidental edits.
