# Plan: Fix `docs/realtime/session-lifecycle.md`

## Context
The session lifecycle doc has three inaccuracies: the states table lists five states while the code (`SessionStatus` enum) defines six (missing `resumed`), the instruction stream section references the old service name `ModuleInstructionService` instead of the renamed `ModuleInstructionStreamService`, and the See Also section violates project conventions and contains a stale table name.

## Settings
- Testing: no
- Logging: no
- Docs: yes (this milestone is a docs fix)

## Tasks

### Phase 1: Fix the document

- [x] **Task 1: Add `resumed` state to the states table and update count**
  Files: `docs/realtime/session-lifecycle.md`
  Line 7 says "пять состояний" — change to "шесть состояний". Add a row to the states table after `disconnected`:
  `| resumed | Сессия возобновлена после переподключения в grace-периоде. |`
  Reference: the enum in `src/realtime/enums/session-status.enum.ts` defines `RESUMED = 'resumed'` as the sixth status. The `database.md` already lists `resumed` in the `status` column description (line 15).

- [x] **Task 2: Rename `ModuleInstructionService` → `ModuleInstructionStreamService`**
  Files: `docs/realtime/session-lifecycle.md`
  Line 29 references `ModuleInstructionService` — change to `ModuleInstructionStreamService`. The proto service was renamed in Phase 7.5; `database.md` already uses the correct name.

- [x] **Task 3: Remove the See Also section**
  Files: `docs/realtime/session-lifecycle.md`
  Project conventions prohibit "See Also" sections in docs. Remove lines 59–63 entirely (the `## See Also` heading and all bullet points beneath it). This also eliminates the stale `live_sessions` table name reference on line 63 (actual table is `module_sessions`).
