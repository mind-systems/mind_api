# Plan: Delete `src/realtime/interfaces/presence-state.interface.ts`

## Context
Remove the unused `PresenceState` interface file that was part of the old presence system.

**Status: already completed.** The file was deleted in commit `e9ee81d` (milestone 40 — "Remove presence from `proto/module_state.proto`"). No source files under `src/` import `presence-state.interface` or reference `PresenceState`. No action required.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

- [x] **Task 1: Delete `src/realtime/interfaces/presence-state.interface.ts`**
  Files: `src/realtime/interfaces/presence-state.interface.ts`
  File already deleted in prior milestone. Verified: no remaining imports or references in `src/`.
