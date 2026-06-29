# Drop the dead getActiveSession mock from the instruction spec

**Date:** 2026-06-29
**Source:** conversation context (completed-work audit, test cleanup)

Test-only cleanup task. A **new task** that edits a committed spec file (the spec belongs to a frozen `[x]` task — so the change is its own task, never an edit to that task). No production code change.

## Problem today
a3 ([[36-generalize-instruction-ingest-ownership]], commit `7f96da3`) routed `module-instruction-stream.grpc.controller.ts` through `getSession` — the controller no longer calls `getActiveSession` (verified: `grep getActiveSession src/realtime/module-instruction-stream.grpc.controller.ts` returns nothing; the resolver is `this.activityEngine.getSession(...)` at `:78`). But `src/realtime/module-instruction-stream.grpc.controller.spec.ts` still carries the now-dead `getActiveSession` mock:
- `:44` — `getActiveSession: jest.fn().mockReturnValue(undefined),` in `makeActivityEngine()` (the stale `// kept …` comment).
- `:116`, `:138`, `:162` — `activityEngine.getActiveSession.mockReturnValue(paused);` in the three **pushing** pause pass-through cases. The dual-mock corrective ([[38-test-instruction-pause-dual-mock]], commit `a5b709f`) already added the adjacent `getSession` seed to each of these, so they resolve correctly without `getActiveSession`.
- `:185` — `activityEngine.getActiveSession.mockReturnValue(...)` in the no-push "should still emit ready frame" case; that case pushes no sample and never resolves a session, so the seed is inert.

## The change (test-only)
- Remove `getActiveSession` from `makeActivityEngine()` (`:44`).
- Remove the `getActiveSession.mockReturnValue(...)` seeds at `:116`, `:138`, `:162` — **keep** the `getSession` seed each case already has (added by note 38), which is what the controller now reads.
- Remove the inert `getActiveSession` seed at `:185`; add nothing (the ready-frame case pushes no sample, so it needs no session seed).

## Verify before deleting
- `grep getActiveSession src/realtime/module-instruction-stream.grpc.controller.{ts,spec.ts}` → after the edit, **zero** matches. Confirm no other helper, ownership case (`describe('streamData — ownership routing …')`), or auth/batch-hygiene case reads `getActiveSession`.
- Run `npx jest src/realtime/module-instruction-stream.grpc.controller.spec.ts` → the pause pass-through suite and all ownership cases stay green (they run on `getSession`).

## Anti-targets
None — `getActiveSession` is dead in this spec; removing it inverts nothing. The `getSession`-based assertions are the live contract and are untouched.
