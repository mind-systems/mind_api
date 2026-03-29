# Plan: Implement `down()` migration

## Context
Fix the `down()` method in `RenameToModuleSessions` so that the enum reverts to `live_sessions_status_enum` (the convention name) instead of `session_status_enum` (the legacy mistake). This is a single-line change — no bridge migration, no `up()` modification.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Background

The original `AddLiveSession` migration created the enum as `session_status_enum`. The project convention (seen in `AddInterruptedSessionStatus`) expects `live_sessions_status_enum`. The `RenameToModuleSessions` migration's `up()` already ran on existing databases, renaming `session_status_enum` → `module_sessions_status_enum`. That `up()` is recorded in the `migrations` table and must not be changed.

The `down()` has never been executed on any database, so it is safe to edit. Changing it to revert the enum to `live_sessions_status_enum` instead of `session_status_enum` normalizes the name on rollback. This means `up()` and `down()` are not perfect inverses — that's intentional. The old name `session_status_enum` was a mistake; after reverting, you land on the corrected convention name.

## Verified: no other changes needed

- `RenameSessionStreamSampleLiveSessionId` (`1774778297835`) already has a correct `down()` — renames column back to `liveSessionId` and recreates the correct index.
- No bridge migration is needed. Adding one would crash existing databases where `session_status_enum` no longer exists (it was already renamed to `module_sessions_status_enum` by the auto-applied `up()`).
- The `up()` must stay unchanged — modifying an already-applied migration creates DB drift between existing and fresh installs.

## Tasks

### Phase 1: Fix enum name in down()

- [x] **Task 1: Change enum revert target in `down()` of `RenameToModuleSessions`**
  Files: `src/migrations/1774779899323-RenameToModuleSessions.ts`

  On line 21, change:
  ```sql
  ALTER TYPE "module_sessions_status_enum" RENAME TO "session_status_enum"
  ```
  to:
  ```sql
  ALTER TYPE "module_sessions_status_enum" RENAME TO "live_sessions_status_enum"
  ```

  Leave everything else in the file untouched — `up()`, table rename, index operations, and PK constraint rename are all correct as-is.
