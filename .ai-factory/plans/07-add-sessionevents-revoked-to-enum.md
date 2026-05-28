# Plan: Add `SessionEvents.REVOKED` to enum

## Context
Append a new `REVOKED` entry to the `SessionEvents` constant so that future code can emit/listen for `session.revoked`. Standalone change — no consumer is wired up yet.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Extend enum

- [x] **Task 1: Append `REVOKED` to `SessionEvents`**
  Files: `src/realtime/events/session.events.ts`
  Add a new key `REVOKED: 'session.revoked'` to the `SessionEvents` const object, placed after the existing `INTERRUPTED` entry. Preserve the existing `as const` assertion and the current key order/formatting style (one entry per line, trailing comma). Do not introduce any consumers, imports, or other changes.

<!-- orchestrator-sessions
planner: 0d0e2231-46f4-4f0f-959e-24262c620bf1
elapsed: 162
implementer: 14d40cb0-7a0f-42c4-90a9-89b14fb60278
-->
