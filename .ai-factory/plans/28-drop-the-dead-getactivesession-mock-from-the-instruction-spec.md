# Plan: Drop the dead `getActiveSession` mock from the instruction spec

## Context
After a3 (commit `7f96da3`) routed `module-instruction-stream.grpc.controller.ts` through `getSession`, the controller no longer calls `getActiveSession`, leaving a dead mock in the spec. This milestone removes that dead mock and its now-inert seeds. Test-only — no production code changes.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Remove dead mock and seeds

- [x] **Task 1: Remove the `getActiveSession` mock from `makeActivityEngine()`**
  Files: `src/realtime/module-instruction-stream.grpc.controller.spec.ts`
  Delete line 44 — `getActiveSession: jest.fn().mockReturnValue(undefined), // kept …`. Keep the adjacent `getSession` mock at line 45 (added by note 38, used by the controller's a3 resolver). The factory should expose `getSession` only.

- [x] **Task 2: Remove the `getActiveSession` seeds in the three pushing pause pass-through cases** (depends on Task 1)
  Files: `src/realtime/module-instruction-stream.grpc.controller.spec.ts`
  Delete the `activityEngine.getActiveSession.mockReturnValue(paused);` lines at `:116`, `:138`, `:162`. **Keep** the adjacent `activityEngine.getSession.mockReturnValue(paused);` seed each case already has — that is what the controller now reads to resolve the paused session.

- [x] **Task 3: Remove the inert `getActiveSession` seed in the no-push ready-frame case** (depends on Task 1)
  Files: `src/realtime/module-instruction-stream.grpc.controller.spec.ts`
  Delete the `activityEngine.getActiveSession.mockReturnValue(makePausedSession({ sessionId }));` seed at `:185`. Add nothing — the "should still emit ready frame on connection even when session is paused" case pushes no sample and never resolves a session, so it needs no session seed.

### Phase 2: Verify

- [x] **Task 4: Confirm `getActiveSession` is fully gone and tests stay green** (depends on Tasks 1-3)
  Files: `src/realtime/module-instruction-stream.grpc.controller.spec.ts`
  Run `grep -n getActiveSession src/realtime/module-instruction-stream.grpc.controller.{ts,spec.ts}` → expect **zero** matches. Confirm no other helper, the ownership routing suite (`describe('streamData — ownership routing …')`), or any auth/batch-hygiene case reads `getActiveSession`. Then run `npx jest src/realtime/module-instruction-stream.grpc.controller.spec.ts` — the pause pass-through suite and all ownership cases must stay green (they run on `getSession`).
