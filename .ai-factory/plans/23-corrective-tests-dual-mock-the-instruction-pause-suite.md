# Plan: Corrective tests — dual-mock the instruction pause suite

## Context
Make the "pause never blocks instruction ingest" characterization cases stay GREEN across a3's `getActiveSession → getSession` resolver swap by seeding **both** resolvers with the paused session in the three pause pass-through cases that push a sample.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Dual-seed the pause pass-through cases

- [x] **Task 1: Seed both resolvers in the three pushing pause cases**
  Files: `src/realtime/module-instruction-stream.grpc.controller.spec.ts`
  In `describe('streamData — pause pass-through')`, the three cases that push a `breath_phase` sample currently seed only `getActiveSession` (lines 115, 137, 161). For each of these three cases, additionally seed `getSession` with the same paused session so the case is GREEN under either resolver (before a3 reads `getActiveSession`, after a3 reads `getSession(userId, sessionId)`). Concretely, in each case replace the single-resolver seed with a shared `paused` fixture wired to both methods, e.g.:
  ```ts
  const paused = makePausedSession({ sessionId });
  activityEngine.getActiveSession.mockReturnValue(paused);
  activityEngine.getSession.mockReturnValue(paused); // ADD — a3 resolver, keyed by (userId, sessionId)
  ```
  Scope is exactly these three seeds:
  - `:113` `it('should call streamEngine.push when session is paused ...')` — seed at `:115`
  - `:135` `it('should respond with ack (not SESSION_PAUSED error) ...')` — seed at `:137`
  - `:159` `it('should not emit an error frame for a paused session ...')` — seed at `:161`
  Do **not** touch:
  - the ready-frame case `it('should still emit ready frame ... even when session is paused')` (`:183`, seed `:185`) — it pushes no sample, never hits the resolver, not a false-RED risk
  - the `makeActivityEngine()` factory (`:42-47`) — it already exposes both methods
  - the ownership target cases (`:247-`) — they own `getSession` already
  Leave every behavioral assertion in the three cases unchanged (`streamEngine.push` called, `ack` present, `error.code !== 'SESSION_PAUSED'`, no error frame). This is characterization (must stay GREEN), not a new target.

- [x] **Task 2: Confirm the pause suite stays GREEN** (depends on Task 1)
  Files: `src/realtime/module-instruction-stream.grpc.controller.spec.ts`
  Run the spec and confirm the pause pass-through cases pass against the current controller (which still reads `getActiveSession`):
  ```bash
  npx jest src/realtime/module-instruction-stream.grpc.controller.spec.ts
  ```
  The ownership routing cases (`:247-`) remain RED until note 36 swaps the controller — that is expected and out of scope for this task. Verify only that the three edited pause cases plus the untouched ready-frame and batch-hygiene cases are GREEN.
