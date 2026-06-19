# Plan: Remove the module-specific pause guards from both realtime stream controllers

## Context
Make the realtime instruction + biometric transports module-agnostic: both controllers must accept and store user-produced samples for any live (non-ended) session regardless of `isPaused`, removing the `SESSION_PAUSED` drop guards (including the leaked `BREATH_PHASE` domain literal). Ships atomically with the Russian docs rewrite and a regression test, since the code change inverts currently-documented, currently-uncovered behavior. Spec: `.ai-factory/notes/49-realtime-accept-samples-through-pause.md`.

## Settings
- Testing: yes (one regression spec — explicitly required by the milestone)
- Logging: minimal
- Docs: yes (Russian — `docs/` convention; the change inverts documented behavior)

## Tasks

### Phase 1: Remove the guards

- [x] **Task 1: Remove the biometric pause guard**
  Files: `src/realtime/module-biometric-stream.grpc.controller.ts`
  Delete "Step 7" — the `if (session.isPaused === true) → emitError('SESSION_PAUSED', ...)` block (lines ~132-139). After removal, control falls straight from the Step 6 `SESSION_MISMATCH` check into the happy path (`batchSessionId` mapping + `streamEngine.pushBatch`). Do **not** touch Steps 1-6 (`INVALID_ARGUMENT` consistency checks, `NO_SESSION`, `SESSION_MISMATCH`), the `ready` emit, ack/error semantics, or the engine call. No other line changes in this file.

- [x] **Task 2: Remove the instruction pause guard and its only-use import**
  Files: `src/realtime/module-instruction-stream.grpc.controller.ts`
  Delete the `if (session.isPaused && msg.instructionType === StreamDataType.BREATH_PHASE) → SESSION_PAUSED` block (lines ~103-115). After removal, control falls from the `SESSION_MISMATCH` check straight into `streamEngine.push(...)`. Then remove the now-unused import `import { StreamDataType } from './constants/stream-data-types';` (line 21) — it was referenced **only** by the deleted guard. Do **not** modify `constants/stream-data-types.ts`: the `StreamDataType` constant and its `SESSION_EVENT` member stay (still used by `ActivityEngine`). Keep `NO_SESSION`/`SESSION_MISMATCH`, the `ready` emit, ack/error handling, and the engine call untouched.

### Phase 2: Docs + regression test

- [x] **Task 3: Rewrite the pause semantics in the biometric-stream doc** (depends on Tasks 1-2)
  Files: `docs/realtime/biometric-stream.md`
  Written in Russian (matches the surrounding docs).
  - Line 13 (`## Когда поток разрешён`): drop the "и не на паузе" precondition — the stream is allowed for any `active`/`resumed` (live, non-ended) session; pause no longer gates acceptance.
  - Rewrite the entire `## Семантика паузы` section (lines 43-49). New framing: the server accepts any sample for a live (non-ended) session regardless of `isPaused`, storing `data` verbatim into jsonb. Acceptance policy is **client-owned** — the client owns sample emission and the session timeline (mind_mobile Phase 42). The server's `session_event` PAUSED/RESUMED markers remain the authoritative wall-clock lifecycle journal (server-stamped, unchanged). Pause *geometry* is client-owned via `breath_phase` markers carrying `data.offsetMs`. Do **not** describe a `phase='resume'` literal — there is none; on resume the client re-emits the real resumed phase, which closes the pause band (band = `[ phase='pause' marker → next real phase marker ]`). Note the two axes (server `session_event` wall-clock / client `breath_phase` offset) are deliberately **not** time-joined.
  - Keep all other sections (form, batching, acks/backpressure, buffering, instruction-stream relation) as-is.

- [x] **Task 4: Sanity-check the protocol doc pause wording** (depends on Tasks 1-2)
  Files: `docs/realtime/protocol.md`
  Review the `activity:pause` / `activity:resume` rows (lines ~18-19) and surrounding text. They currently describe only the in-memory `isPaused` flag toggle and imply **no** sample rejection — so most likely **no change is needed**. Edit only if any wording implies samples are rejected while paused; if nothing implies it, leave the file unchanged.

- [x] **Task 5: Add a pass-through regression spec for both controllers** (depends on Tasks 1-2)
  Files: `src/realtime/module-biometric-stream.grpc.controller.spec.ts` (new), `src/realtime/module-instruction-stream.grpc.controller.spec.ts` (new)
  Follow the existing controller-spec pattern (`module-state.grpc.controller.spec.ts`): instantiate the controller directly with hand-rolled jest-mock dependencies (`streamEngine`, `activityEngine`, `activeStreamRegistry`), drive the request via an rxjs `Subject`, and collect responses from the returned `Observable` via `subscriber.next`.
  - **Biometric spec:** mock `activityEngine.getActiveSession` to return a session with `isPaused === true` and matching `sessionId`; mock `streamEngine.pushBatch` to return a result (`{ totalReceived, totalDropped, droppedCount }`). Push a valid `BioSampleBatch` (non-empty, consistent `sessionId`, non-empty `sampleType`). Assert: `streamEngine.pushBatch` was called and the response is an `ack` (not an `error` with code `SESSION_PAUSED`).
  - **Instruction spec:** mock `getActiveSession` to return a paused session with matching `sessionId`; mock `streamEngine.push` to return `{ totalReceived, droppedCount, accepted: true }`. Push a `StreamSample` with `instructionType` set to the breath-phase value (`StreamDataType.BREATH_PHASE`). Assert: `streamEngine.push` was called and the response is an `ack` (not an `error` with code `SESSION_PAUSED`).
  - Both specs lock in the new pass-through behavior, which was previously uncovered.

## Verification (manual, post-implementation)
- `npm run build` compiles (no dangling `StreamDataType` reference in the instruction controller).
- `npx jest src/realtime/module-biometric-stream.grpc.controller.spec.ts src/realtime/module-instruction-stream.grpc.controller.spec.ts` is green.
- `npm run lint` passes (catches the unused import if Task 2's import removal was missed).
- No proto change, no schema/migration change, no edit to the stream engines or the `ActivityEngine` `SESSION_EVENT` injection.

## Commit Plan
- **Commit 1** (after tasks 1-5): "Accept realtime instruction and biometric samples through pause"
