# Plan: Verify `ChangeLogService.getChanges()`

## Context
Confirm the `getChanges()` method exists in `ChangeLogService` with the signature needed by the streaming sync controller (Phase 3.3) before proceeding with `WatchChanges` implementation.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Verification Result

**The method already exists.** No code changes are required.

`src/changelog/changelog.service.ts` exports:

```ts
getChanges(userId: string, afterId: number, limit = 100): Promise<ChangesResult>
```

`ChangesResult` (exported interface in the same file):

```ts
interface ChangesResult {
  events: ChangeEvent[];
  cursor: number;
  hasMore: boolean;
}
```

This is a superset of what the milestone describes (`{ events: ChangeRecord[], hasMore: boolean }`):
- `events` — array of `ChangeEvent` entities (the roadmap used the speculative name `ChangeRecord`; the real entity is `ChangeEvent` from `src/changelog/entities/change-event.entity.ts`)
- `hasMore` — boolean, derived from a `limit + 1` fetch strategy
- `cursor` — extra field (last event `id`), already consumed by `SyncService.getChanges()` and the gRPC controller

### Callers today
| Caller | File | Usage |
|--------|------|-------|
| `SyncService.getChanges()` | `src/sync/sync.service.ts:39` | Delegates to `changeLogService.getChanges(userId, afterId, limit)`, projects events to public DTO shape, detects `fullResync` via `getMinEventId()` |
| `SyncController` (REST) | `src/sync/sync.controller.ts:40` | `GET /sync/changes` — calls `syncService.getChanges()` |
| `SyncGrpcController` | `src/sync/sync.grpc.controller.ts:32` | `GetChanges` RPC — calls `syncService.getChanges()` |

### Availability for Phase 3.3
`ChangeLogService` is provided by `ChangelogModule` which is `@Global()` — any module (including the future streaming controller) can inject it without explicit import. The `WatchChanges` replay phase can call `changeLogService.getChanges(userId, afterId, limit)` directly in a loop until `hasMore === false`.

## Tasks

- [x] **Task 1: Verify method exists — no-op**
  Files: `src/changelog/changelog.service.ts`
  Open the file and confirm `getChanges(userId, afterId, limit)` is present and returns `ChangesResult` with `events`, `cursor`, and `hasMore`. The method exists at line 63. No changes needed.
