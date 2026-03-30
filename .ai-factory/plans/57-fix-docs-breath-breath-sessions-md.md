# Plan: Fix `docs/breath/breath-sessions.md`

## Context
The file `docs/breath/breath-sessions.md` contains several stale HTTP-era references that no longer match the codebase after the gRPC migration. This plan updates all of them in a single pass: HTTP method names, the batch endpoint section, and the WebSocket-push reference.

## Settings
- Testing: no
- Logging: no
- Docs: yes (documentation-only change)

## Tasks

### Phase 1: Update stale HTTP/WebSocket references to gRPC

- [x] **Task 1: Replace HTTP method names with gRPC RPC names (lines 83–84)**
  Files: `docs/breath/breath-sessions.md`
  Replace:
  ```
  - При **создании** сессии (`POST`)
  - При **обновлении** сессии (`PATCH`, `PUT`) — пересчитывается, если изменились `exercises`
  ```
  With:
  ```
  - При **создании** сессии (`CreateSession`)
  - При **обновлении** сессии (`UpdateSession`, `ReplaceSession`) — пересчитывается, если изменились `exercises`
  ```
  These match the RPC method names in `breath-sessions.grpc.controller.ts`.

- [x] **Task 2: Replace HTTP timeOfDay reference with gRPC RPC names (line 101)**
  Files: `docs/breath/breath-sessions.md`
  Replace `POST`, `PATCH`, `PUT` in the sentence about `timeOfDay` with `CreateSession`, `UpdateSession`, `ReplaceSession`. All three RPCs accept `timeOfDay` in their request messages.

- [x] **Task 3: Rewrite batch endpoint section for gRPC (lines 105–119)**
  Files: `docs/breath/breath-sessions.md`
  Rewrite the "Пакетная загрузка" section. Replace:
  - Section heading: `GET /breath-sessions/batch` → `BatchGetSessions`
  - Parameter description: comma-separated query string → `ids` field (repeated string, max 50) in `BatchGetSessionsRequest`
  - Remove the `GET /breath-sessions/batch?ids=uuid1,uuid2,uuid3` URL example; replace with a gRPC request shape showing the `ids` field
  - Replace `OptionalJwtAuthGuard` → `@GrpcOptionalAuth()` (matching the decorator in `breath-sessions.grpc.controller.ts` line 110)
  - Keep the behavioral description unchanged: optional auth adds `isStarred`, missing IDs are silently skipped

- [x] **Task 4: Replace WebSocket-push reference with gRPC stream (line 125)**
  Files: `docs/breath/breath-sessions.md`
  Replace the clause `а подключённый клиент получает WebSocket-push `sync:changed`` with `а подключённый клиент получает уведомление через gRPC-стрим `WatchChanges``. Keep the rest of the sentence and the link to `../sync/sync.md` unchanged. This matches the terminology in `docs/sync/sync.md`.
