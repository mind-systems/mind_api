# Plan: Tests — instruction ingest ownership for N sessions

## Context
Rewrite the instruction-stream controller spec to guard ownership-addressed ingestion: phases for two concurrent live child ids both push, a root-tagged mark pushes under `root.id`, and an unowned id is rejected `SESSION_NOT_FOUND`. The three ownership cases are committed RED until feature note 36 swaps the controller from `getActiveSession` → `getSession`. All existing characterization cases (auth, ready, paused-but-owned push, missing-sessionId) stay GREEN.

**RED/GREEN contract (corrected per plan-review-1, Option A):** This milestone does **not** implement feature 36 — the controller still calls `this.activityEngine.getActiveSession(userId)` after this commit. Therefore the pause pass-through suite must stay wired to `getActiveSession` so it remains genuinely GREEN. We only **add** `getSession` to the mock factory (used by the new target cases). The inversion of the pause-suite mock lines (`:114/:136/:159`) belongs to feature 36's commit (alongside the controller swap that makes it correct), **not** here. After this commit: auth, ready, pause-push trio, register, and missing-arg GREEN; the three new ownership target cases RED.

## Settings
- Testing: yes (this milestone IS the test authoring)
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Add the ownership resolver to the mock factory (non-destructive)

- [x] **Task 1: Add `getSession` to `makeActivityEngine()`, keep `getActiveSession`**
  Files: `src/realtime/module-instruction-stream.grpc.controller.spec.ts`
  In `makeActivityEngine()` (`:42-46`), expose **both** methods:
  ```js
  function makeActivityEngine() {
    return {
      getActiveSession: jest.fn().mockReturnValue(undefined), // kept — pause suite + current controller still use it
      getSession: jest.fn(),                                  // added — used by the new ownership target cases
    };
  }
  ```
  Per note 36 the feature later adds `activityEngine.getSession(userId, sessionId): ActivityState | undefined` resolving child-or-root for owned ids, else `undefined`; `ActivitySessionStore.getSession` already implements that child-or-root resolution. Default `getSession` to returning `undefined` for unconfigured ids so unowned-id paths behave correctly. Leave `streamEngine` (`push` returning `{ accepted:true, droppedCount:0, totalReceived:1 }`) and `activeStreamRegistry` mocks and the 3-arg ctor unchanged.
  **Do not touch** the pause-suite lines `:114/:136/:159` — they stay wired to `getActiveSession` in this commit (their inversion moves to feature 36).

### Phase 2: Add target + missing-arg characterization cases

- [x] **Task 2: Add target cases — two children, root mark, unowned reject** (depends on Task 1)
  Files: `src/realtime/module-instruction-stream.grpc.controller.spec.ts`
  Add a `describe('streamData — ownership routing (target, RED until note 36)')` with three cases. **Drive synchronously and assert after `request$.next(...)` — do not gate `done()` on an ack** (under today's controller these cases never ack: the new tests configure `getSession`, but the controller still calls `getActiveSession`, which returns `undefined` → `NO_SESSION`, no push; an ack-gated test would hang to the jest timeout instead of failing fast). Since `request$` is a `Subject` and the controller's `next` handler runs synchronously, collect emitted frames into an array, push the sample(s), then assert immediately on the `push` spy and the collected frames (skipping the leading `ready` frame). No `done()` callback.
  - **two concurrent children both accepted** — `getSession.mockImplementation((u, sid) => ['child-A','child-B'].includes(sid) ? makePausedSession({ sessionId: sid }) : undefined)`. Push a phase for `child-A` and one for `child-B`; assert `streamEngine.push` called with `'child-A'` and with `'child-B'` (two calls, one per id), two acks, no error frame.
  - **root-tagged mark accepted** — `getSession` returns the root state for `'root-1'`; push a sample with `sessionId:'root-1'`; assert `push('root-1', expect.objectContaining(...))` and an ack frame.
  - **unowned session rejected** — `getSession` returns `undefined` for `'someone-else'`; push a sample with that id; assert an `error` frame with `code === 'SESSION_NOT_FOUND'` and that `push` was NOT called for that id.
  (Reusing `makePausedSession` — which sets `isPaused:true` — for the owned states is fine: the ingest path never reads `isPaused`, only truthiness matters.)

- [x] **Task 3: Add missing-sessionId characterization case** (depends on Task 1)
  Files: `src/realtime/module-instruction-stream.grpc.controller.spec.ts`
  Add a case (in a `describe('streamData — batch hygiene')` or alongside auth) that pushes a sample with `sessionId: ''`; assert an `error` frame with `code === 'INVALID_ARGUMENT'` and that `streamEngine.push` is NOT called. The `''` case alone exercises the `if (!msg.sessionId)` guard (`:67-76`) and needs no cast; a `sessionId: undefined` variant is optional and would require `makeBreathPhaseSample(undefined as any)` since the proto type is `string`. This path is already implemented and loud, so it is GREEN now and stays GREEN — a smoke check. Keep the existing auth cases (`UNAUTHENTICATED` + `register` not called) intact.

## Notes for the implementer
- Do **not** implement feature note 36 here — the three ownership target cases are committed RED on purpose. Do not `skip`/`xit` them.
- Do **not** invert the pause-suite mock lines (`:114/:136/:159`) in this commit — that inversion belongs to feature 36's commit, where the controller switches to `getSession` and makes them correct. Inverting them now would throw `TypeError` at runtime (controller still calls `getActiveSession`) and flip genuine characterization tests RED.
- Run `npx jest src/realtime/module-instruction-stream.grpc.controller.spec.ts` to confirm: auth, ready, pause-push trio, register, and missing-arg GREEN; the three ownership target cases RED (failing cleanly via synchronous assertion, not timing out).
- The retired `'NO_SESSION'` / `'SESSION_MISMATCH'` codes have no committed test asserting them, so there is nothing else to invert.
- Single commit at the end: "Add ownership-routing tests for instruction ingest".
