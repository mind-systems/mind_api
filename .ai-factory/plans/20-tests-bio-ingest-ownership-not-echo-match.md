# Plan: Tests — bio ingest ownership, not echo-match

## Context
Commit a TDD test (RED until feature note 35) that guards bio ingest's silent owner-resolution: a batch is stored under the **server-resolved** `root.id` regardless of the client-echoed `session_id`. The deliverable is edits to `src/realtime/module-biometric-stream.grpc.controller.spec.ts` only — no controller change in this task.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Invert the anti-target and add target/characterization cases

- [x] **Task 1: Invert the single `SESSION_MISMATCH` anti-target into an acceptance target**
  Files: `src/realtime/module-biometric-stream.grpc.controller.spec.ts`
  In `describe('streamData — bio bound to root')`, replace the case currently at `:276-292` (`'… should reject a batch whose session_id is a child id with SESSION_MISMATCH'`). Keep `ensureRoot → makeRoot({ id: 'root-1' })` and the `child-9` batch, but invert the assertions to acceptance:
  - rename to `[RED until note 35] child-id echo is accepted and stored under root`;
  - assert `frame.ack` is defined and `frame.error` is undefined;
  - assert `frame.ack!.sessionId === 'root-1'`;
  - assert `streamEngine.pushBatch` was called with `'root-1'` as the first arg (`expect(streamEngine.pushBatch).toHaveBeenCalledWith('root-1', expect.any(Array))`).
  This is RED today (controller step 6 at controller `:124-131` emits `SESSION_MISMATCH`, no push) and turns GREEN when note 35 deletes step 6. Confirm via `grep -n SESSION_MISMATCH src/realtime/module-biometric-stream.grpc.controller.spec.ts` that this was the only occurrence in the spec before editing.

- [x] **Task 2: Add the stale/arbitrary-echo target case** (depends on Task 1)
  Files: `src/realtime/module-biometric-stream.grpc.controller.spec.ts`
  Add a second target case in the same `describe` block, mirroring Task 1 but using an arbitrary echo: `ensureRoot → makeRoot({ id: 'root-1' })`, batch via `makeBatch('whatever')`. Assert the first non-ready frame is an ack (no error), `ack.sessionId === 'root-1'`, and `pushBatch` called with `'root-1'`. Label `[RED until note 35] stale/arbitrary echo is accepted under root`. Use the existing `firstNonReadyFrame` helper.

- [x] **Task 3: Add the overflow `droppedCount` characterization case** (depends on Task 2)
  Files: `src/realtime/module-biometric-stream.grpc.controller.spec.ts`
  Add a characterization case (must be GREEN now and after note 35) asserting overflow surfaces via the ack, without inspecting buffer internals:
  - `ensureRoot → makeRoot({ id: 'root-1' })`;
  - override the engine for this case: `streamEngine.pushBatch.mockReturnValue({ acceptedCount: 0, droppedCount: 1, totalReceived: 1, totalDropped: 1 })`;
  - send `makeBatch('root-1')`, capture the first non-ready frame;
  - assert `frame.ack` defined and `frame.ack!.droppedCount === 1` (controller acks `droppedCount: result.totalDropped`, controller `:146`).
  Label `[characterization — must stay GREEN]`.

## Notes for the implementer (keep GREEN, do not touch)
- Leave the existing GREEN-after-note-35 cases intact: correct root-id echo push (`:255-274`), `NO_ROOT_SESSION` on `ensureRoot → undefined` (`:294-309`), paused-root acceptance (`:311-329`), and all batch-hygiene `INVALID_ARGUMENT` smoke cases (`:183-248`). These are characterization — note 35 leaves them unchanged.
- Re-use the existing fixtures/helpers only: `makeUser`, `makeStreamEngine`, `makeActivityEngine`, `makeRoot`, `makeActiveStreamRegistry`, `makeBatch`, and `firstNonReadyFrame`. Do not add new helpers or change the controller.
- Do **not** implement the feature or delete controller step 6 here — that is note 35. This task commits RED targets only.
- After editing, run `npx jest src/realtime/module-biometric-stream.grpc.controller.spec.ts` to confirm: the two new target cases (Tasks 1–2) fail cleanly with `SESSION_MISMATCH`/no-push (not a hang), and every characterization case (including Task 3) passes.
