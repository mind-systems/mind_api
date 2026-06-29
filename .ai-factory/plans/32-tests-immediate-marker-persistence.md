# Plan: Tests — immediate marker persistence

## Context
Add TDD tests (committed RED) to `stream-engine.service.spec.ts` that guard the silent gap where a discrete `SESSION_EVENT` marker is buffered and lost on a crash before the periodic flush. The target cases stay RED until feature note 25 lands; the continuous-stream contrast cases stay GREEN now and after.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Immediate marker persistence tests

- [x] **Task 1: Add a marker-sample helper and import `StreamDataType`**
  Files: `src/realtime/services/stream-engine.service.spec.ts`
  At the top of the spec, add the import `import { StreamDataType } from '../constants/stream-data-types';` (alongside the existing imports). Add a new factory helper next to the existing `makeSample`:
  ```ts
  function makeMarkerSample(
    event = 'paused',
    timestamp = 1000,
  ): InstructionSample {
    return { timestamp, data: { dataType: StreamDataType.SESSION_EVENT, event } };
  }
  ```
  Do **not** modify the existing `makeSample` (`{ timestamp, data: 'x' }`) — every committed batch case depends on its string `data` (no `dataType`) staying on the buffered path. This task only adds the helper/import; no behavior is asserted yet.

- [x] **Task 2: Add the "immediate marker persistence" describe block (target cases, RED until spec 25)** (depends on Task 1)
  Files: `src/realtime/services/stream-engine.service.spec.ts`
  Add a new `describe('immediate marker persistence', ...)` block driving the **real** `engine` from the existing `beforeEach`. Follow the spec note `.ai-factory/notes/30-test-immediate-marker-persistence.md` exactly. Label every target case `RED until spec 25-persist-ispaused` in its `it(...)` name. Cases:
  - **Single marker writes immediately** — `repo.save.mockResolvedValue({})`, then `engine.push('s1', makeMarkerSample('paused'))`. Assert **synchronously** (no `await`, no fake-timer advance — the `save()` call is synchronous, only its promise resolution is async): `repo.create` was called with `expect.objectContaining({ moduleSessionId: 's1', samples: [<the marker sample>], flushedAt: expect.any(Date) })` — assert the one-element `samples` array (`[makeMarkerSample('paused')]`) to distinguish the immediate write from a batch flush; and `repo.save` was called (`toHaveBeenCalled`).
  - **Two distinct markers → two immediate one-element saves** — `push` two different markers (e.g. `'paused'` then `'resumed'`); assert `repo.save` called twice, each with a one-element `samples` row (not one batched two-element row).
  Do **not** assert on `push`'s `PushResult` return value (unchanged for markers). Do **not** inspect the engine's private `buffers` map — assert only mock-visible `repo.create`/`repo.save` calls.

- [x] **Task 3: Add the continuous-stream contrast cases (characterization, GREEN now and after)** (depends on Task 1)
  Files: `src/realtime/services/stream-engine.service.spec.ts`
  In the same describe block, add the contrast cases that prove the high-volume stream stays batched:
  - **A `breath_phase` push does not write immediately** — `engine.push('s1', { timestamp: 1000, data: { phase: 'exhale' } })` (a `data` object with **no** `dataType`). Assert `repo.save` was **not** called right after `push`; then `await engine.flush('s1')` and assert `repo.save` was called once (it was buffered and persisted only on flush). RED-safe both now and after — this is the contrast value.
  - **The committed `makeSample` path is unchanged** — `engine.push('s1', makeSample())` (string `data`, no `dataType`) does not call `repo.save` synchronously; it persists on a subsequent `flush`. This reaffirms that the existing batch cases stay GREEN.
  No anti-targets to delete/invert: per the spec note, every committed `push`-then-assert case uses string-`data` `makeSample`, so all batch/overflow/flush cases stay GREEN under the new branch.

- [x] **Task 4: Confirm RED/GREEN split and suite health** (depends on Task 2, Task 3)
  Files: `src/realtime/services/stream-engine.service.spec.ts`
  Run `npx jest src/realtime/services/stream-engine.service.spec.ts`. Expect: the two Task-2 target cases **FAIL** (current `push` only buffers, no immediate save) — this is the intended committed-RED state for spec 25. Every other case in the file — the Task-3 contrast cases and all pre-existing `push`/`flush`/`flushAll`/`periodic flush`/`lifecycle`/`concurrency` cases — must **PASS**. If any pre-existing case turns red, that is a regression (escalation valve L4) — stop and report, do not weaken the existing case. Also run `npm run lint` on the changed file to confirm it compiles clean.
