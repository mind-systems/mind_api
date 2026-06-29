# Corrective test plan — dual-mock the instruction pause pass-through suite

**Date:** 2026-06-29
**Source:** conversation context (handoff 08-root-as-module-activity-type §3-C-2)

Corrective test task. Guards the characterization invariant "**pause never blocks instruction ingest**" across a3's resolver swap ([[36-generalize-instruction-ingest-ownership]]). A **committed-test change → its own task** (the committed spec is `e15674a`), not an edit to the frozen [[33-test-instruction-ownership]].

## Why this exists (the gap)
T3 ([[33-test-instruction-ownership]]) added the ownership target cases and made `makeActivityEngine()` expose **both** resolvers (`module-instruction-stream.grpc.controller.spec.ts:42-46`):
```ts
function makeActivityEngine() {
  return {
    getActiveSession: jest.fn().mockReturnValue(undefined), // kept — pause suite + current controller still use it
    getSession: jest.fn().mockReturnValue(undefined),        // added — used by the new ownership target cases
  };
}
```
But the **pause pass-through** suite (`describe('streamData — pause pass-through')`, `:112`) still seeds only `getActiveSession` in the **three cases that push a sample** and thus hit the resolver:
- `:115` `activityEngine.getActiveSession.mockReturnValue(makePausedSession({ sessionId }))`
- `:137` same
- `:161` same

a3 swaps the controller's resolver from `getActiveSession` to `getSession(userId, msg.sessionId)`. After that swap, those **three** cases resolve through `getSession`, which still defaults to `undefined` → the controller emits `SESSION_NOT_FOUND` and never pushes/acks → the characterization cases **false-RED**. This is the defect that was hand-reverted once; formalize it as a task.

**Not in scope:** the fourth pause case, `it('should still emit ready frame on connection even when session is paused')` (`:183`, seed at `:185`), pushes **no** sample — it only subscribes and asserts the synchronous `ready` frame, so it never calls `getActiveSession`/`getSession` and is **not** at risk of the post-a3 false-RED. Leave its seed as-is (or dual-seed it belt-and-suspenders, but it is not a false-RED case).

## The change (characterization — must stay GREEN, not a target)
In each pause pass-through case, seed **both** resolvers with the paused session so the suite is GREEN under either resolution mechanism (before and after the a3 swap):
```ts
const paused = makePausedSession({ sessionId });
activityEngine.getActiveSession.mockReturnValue(paused);
activityEngine.getSession.mockReturnValue(paused);   // ADD — keyed by (userId, sessionId)
```
Apply at the three pushing cases `:115`, `:137`, `:161`. (Optionally use `getSession.mockImplementation((_u, sid) => sid === sessionId ? paused : undefined)` for precision, mirroring the ownership cases at `:249`/`:285`.) The `:183`/`:185` ready-frame case needs no change (it pushes nothing). Nothing else in the suite changes — the behavioral assertions (`streamEngine.push` called, ack present, `error.code !== 'SESSION_PAUSED'`, no error frame, `ready` frame on subscribe) are unchanged and must stay GREEN.

## Inlined contracts (self-contained)
- **`makePausedSession(overrides?)`** (`spec :23`) → `{ sessionId, isPaused: true, ... }` (an `ActivityState`-shaped fixture). The controller only needs truthiness (owned & live) + that ingest is not gated on `isPaused`.
- **`getSession(userId, sessionId): ActivityState | undefined`** — the a3 resolver; returns the owned child-or-root state or `undefined`. Keyed by `(userId, sessionId)`.
- **Pause is not a gate:** the instruction controller has **no** `SESSION_PAUSED` branch — a `breath_phase` for a paused-but-owned session still `push`es and acks. That invariant is what these cases lock.

## Two-state observability
The vantage is the same as the committed suite: drive `streamData(request$, user)`, push `makeBreathPhaseSample(sessionId)`, assert the `ack` frame and `streamEngine.push` spy. With the dual seed, the case is GREEN both **today** (controller reads `getActiveSession`) and **after a3** (controller reads `getSession`) — proving it is a true characterization guard across the swap, not a target that flips.

## Findings
- The mock **factory** already lists both methods (`:44-45`); only the three **pushing** pause cases (`:115/:137/:161`) are missing the `getSession` line and at risk of the post-a3 false-RED. Scope is exactly those three seeds — the `:185` ready-frame case pushes nothing (out of scope); do not touch the ownership target cases (`:247-`) or the factory.
- Do not edit the frozen [[33-test-instruction-ownership]]; this note owns the committed-spec change.
