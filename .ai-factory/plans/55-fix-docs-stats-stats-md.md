# Plan: Fix `docs/stats/stats.md`

## Context
The architecture diagram in `docs/stats/stats.md` references the outdated component name `GraceTimerManager` (should be `ActivitySessionStore`) and only lists two qualifying events instead of three.

## Settings
- Testing: no
- Logging: no
- Docs: yes (this milestone is a docs-only fix)

## Tasks

### Phase 1: Fix architecture diagram

- [x] **Task 1: Update component name and event list in the diagram**
  Files: `docs/stats/stats.md`
  In the "Внутренняя архитектура" code block (lines 101–111):
  1. Replace `GraceTimerManager` with `ActivitySessionStore` on line 102.
  2. Replace `session.completed / session.abandoned` with `session.completed / session.abandoned / session.interrupted` on line 104.
  The prose section on line 68 already correctly lists all three events — no changes needed there.
