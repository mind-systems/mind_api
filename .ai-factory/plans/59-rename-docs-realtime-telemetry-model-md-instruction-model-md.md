# Plan: Rename `docs/realtime/telemetry-model.md` → `instruction-model.md`

## Context
Rename the doc file to remove leftover "telemetry" Socket.io vocabulary and update all inbound references across the project.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Rename and update references

- [x] **Task 1: Rename the file**
  Files: `docs/realtime/telemetry-model.md` → `docs/realtime/instruction-model.md`
  Use `git mv docs/realtime/telemetry-model.md docs/realtime/instruction-model.md` to rename the file while preserving git history.

- [x] **Task 2: Update link in `docs/realtime/protocol.md`** (depends on Task 1)
  Files: `docs/realtime/protocol.md`
  Line 60 in the "See Also" section references `(telemetry-model.md)`. Change it to `(instruction-model.md)`.

- [x] **Task 3: Update doc table in `CLAUDE.md`** (depends on Task 1)
  Files: `CLAUDE.md`
  Line 113 in the Documentation table has path `docs/realtime/telemetry-model.md`. Change it to `docs/realtime/instruction-model.md`.

- [x] **Task 4: Update doc table in `AGENTS.md`** (depends on Task 1)
  Files: `AGENTS.md`
  Line 45 has path `docs/realtime/telemetry-model.md`. Change it to `docs/realtime/instruction-model.md`.

### Note
The milestone mentions inbound links from `session-lifecycle.md` and `database.md`, but neither file currently contains a link to `telemetry-model.md` — only `protocol.md` does. No changes needed for those two files.
