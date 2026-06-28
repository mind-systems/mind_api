# Plan: Tests — bio ingest bound to root

## Context
TDD test milestone guarding the **silent** parts of moving bio ingest from the active child to the user's root: a batch pushed with the wrong owner id (bio attributed to a child → invisible to the windowed read) and the flush no longer firing on root lifecycle (buffered bio silently lost on root teardown). Loud error paths (batch-consistency rejections) get only a smoke check. No feature code is written here. Spec: `.ai-factory/notes/21-test-bio-ingest-to-root.md`, feature it precedes: `.ai-factory/notes/10-bio-ingest-to-root.md`.

## Settings
- Testing: yes (this milestone *is* the tests — extend existing Jest specs, write no production code)
- Logging: minimal
- Docs: no

## Pinned cross-spec decisions (record in the note's Findings and escalate BEFORE authoring target cases)

The test note (21) and the feature note (10) disagree on the resolution mechanism, and the engine needs no change at all — both facts decide whether each case is target-RED or characterization-GREEN. These pins are the contract the **test** and the **feature** (spec 10) must share; if spec 10 cannot honor one, the test author re-pins it here first. They are what makes the target cases flip GREEN when spec 10 lands instead of staying RED for the wrong reason.

- **P1 — resolution mechanism is `ensureRoot`, not `getRoot`.** Note 10's locked decision is that a bio-only connection **creates** a root (`await this.activityEngine.ensureRoot(userId)`), so `handleBatch` becomes **async** and the resolved owner is (almost) never null. Note 21's instantiation ("`getRoot` stub") is **superseded** — record the divergence. Target tests stub `activityEngine.ensureRoot` (added via `jest.fn()`, accessed `as any` since the method does not exist yet — L2 compile-now) returning a `ModuleSession`-shaped object. `NO_ROOT_SESSION` is emitted **only** in the unexpected case where `ensureRoot` itself yields nothing (note 10 §Decisions).
- **P2 — owner id field is `root.id`.** `ensureRoot` returns a `ModuleSession`, so push and compare against `root.id` (not `root.sessionId`); `ack.sessionId === root.id`. Carve-out: if spec 10 instead forwards a store `ActivityState`, the field is `.sessionId` — re-pin here.
- **P3 — error codes are literal strings.** The new no-root branch emits `WsErrorCode.NO_ROOT_SESSION`, whose value is the literal `'NO_ROOT_SESSION'` (`ws-error-codes.ts:4`), **replacing** the old literal `'NO_SESSION'` at step 5. `SESSION_MISMATCH` stays the literal `'SESSION_MISMATCH'`; steps 1–4 stay `'INVALID_ARGUMENT'`. Assert these exact strings on `frame.error.code` (today the controller emits literals, not `WsErrorCode.*` — note 21 Exact pins).
- **P4 — the engine is structurally unchanged (note 10 §Engine), so its flush/lifecycle cases are CHARACTERIZATION (GREEN now), not target.** `pushBatch` is keyed by an arbitrary `sessionId` and the four `@OnEvent` handlers already flush+clear by `payload.sessionId` (`biometric-stream-engine.service.ts:86,204-250`); passing `root.id` makes the buffer per-root automatically, and `doFlush` already no-ops a missing buffer (`:150-157`). Therefore note 21's "Lifecycle flush — target→10" cases are **reclassified to characterization** — written at the engine they are GREEN now and guard spec 10/04 against breaking the engine's id-agnostic flush. The genuine **target (RED-until-10) silent signal lives at the controller**: that `streamEngine.pushBatch` is called with `root.id` (the resolved owner). Whether the root actually *emits* ABANDONED/REVOKED with its own id is spec 04's root lifecycle — the engine merely reacts; do not try to prove that here.
- **P5 — the legacy pause pass-through chars are coupled to the retired mechanism.** The existing tests at `module-biometric-stream.grpc.controller.spec.ts:114-209` stub `getActiveSession` and send a batch carrying the **child** sessionId. Spec 10 swaps step 5 to `ensureRoot`, so those tests will false-RED unless spec 10 migrates them. Flag this for spec 10. Here, re-express the pause invariant (note 21 Gotcha: "Pause does not block bio") as a **forward target** test against a live root.
- **P6 — two-state observability mechanism.** Drive through `streamData(request$, user)` and assert the **first non-`ready` response frame** (ack or error), not a `done()` that waits only for an ack. Today the controller still calls `getActiveSession` (→ `undefined` → emits a `NO_SESSION` error frame, never an ack), so a forward target asserting an ack would **timeout/hang** rather than fail cleanly. Capturing the first non-ready frame yields a clean RED today (wrong code / error-instead-of-ack) and GREEN after spec 10 — never a hang (note 21 L2 / two-state observability lesson).

## Key constraints (read before writing — from the spec note)

- **RED/GREEN contract.** Target cases are expected to FAIL now and turn GREEN only when spec 10 lands — do NOT `.skip`/`.todo`/`it.failing` them and do NOT implement the feature. Label each `[RED until spec 10-bio-ingest-to-root]` (spec name, never a phase number — L3). Characterization cases must stay GREEN; a RED there after the behavior-preserving feature = genuine Class-B regression → escalate, never patch (L4 escalation valve).
- **Outcomes only (L1).** Assert the OUTCOME, never internal structure: "pushed with root.id" = `streamEngine.pushBatch` was called with `root.id`, not the buffer map; overflow = the `ack.droppedCount` / `result.totalDropped` counter, never `BioSessionBuffer.byteSize`/`.samples`; rejection = the emitted `error.code` string, not the validation branch order.
- **Compile-now (L2).** `activityEngine.ensureRoot` does not exist yet — add `ensureRoot: jest.fn()` to the engine mock and access `as any`. Root fixtures use `activityType: 'root' as any`.
- **Behavior re-derivation.** Before writing, re-trace bio through the new model: a child that completes never owned a buffer (the COMPLETED handler must be a harmless no-op for the child id); a root that is abandoned/revoked must flush by its own id. Any lifecycle gap or mechanism mismatch → the note's **Findings**, escalated to spec 10 before it is implemented.

## Tasks

### Phase 0: Pin and escalate before authoring

- [x] **Task 1: Record pins P1–P6 in the spec note's Findings and escalate to spec 10**
  Files: `.ai-factory/notes/21-test-bio-ingest-to-root.md`
  Write P1–P6 into the note's **Findings** section as the agreed test↔feature contract. Flag the consequential ones for spec 10 to honor when implemented: P1 (`ensureRoot`, async `handleBatch`, `NO_ROOT_SESSION` only on a null root — supersedes the note's `getRoot` framing), P4 (engine unchanged → its lifecycle cases are characterization; the only controller-level target is `pushBatch(root.id, …)`), and P5 (spec 10 must migrate the legacy `getActiveSession` pause chars). This must precede authoring the target cases — it is what makes them flip GREEN when spec 10 lands instead of staying RED for the wrong reason.

### Phase 1: Controller — root resolution + smoke (extend `module-biometric-stream.grpc.controller.spec.ts`)

- [x] **Task 2: Extend the controller spec harness** (depends on Task 1)
  Files: `src/realtime/module-biometric-stream.grpc.controller.spec.ts`
  Extend the existing mock setup without disturbing the current GREEN tests:
  - Add `ensureRoot: jest.fn()` to `makeActivityEngine()` (keep `getActiveSession` for the legacy pause chars). Default it unset/`undefined` per case.
  - Add a `makeRoot(overrides?)` fixture returning a `ModuleSession`-shaped object: `{ id: 'root-1', activityType: 'root' as any, isPaused: false, ...overrides }`.
  - Add a `firstNonReadyFrame(controller, request$, user, batch)` helper (per P6) that subscribes, sends the batch, and resolves a Promise with the first response frame whose `.ready` is undefined (ack or error). Use the existing `Subject`/`subscribe` pattern (controller spec lines 92–137); unsubscribe on resolve. This avoids any `done()` that would hang today.

- [x] **Task 3: Add target controller cases for root binding** (depends on Task 2)
  Files: `src/realtime/module-biometric-stream.grpc.controller.spec.ts`
  Add a `describe('streamData — bio bound to root')` block. Each case stubs `activityEngine.ensureRoot` (P1) and asserts the first non-ready frame / `pushBatch` call (P2, P6):
  - `[RED until spec 10-bio-ingest-to-root]` should resolve the user's root and call `pushBatch(root.id, …)`. Stub `ensureRoot` → `makeRoot({ id: 'root-1' })`; send `makeBatch('root-1')`; assert the frame is an `ack` AND `streamEngine.pushBatch` was called with `'root-1'` as the first arg and `ack.sessionId === 'root-1'` (L1 — the wrong-owner silent-bug guard). Today: controller calls `getActiveSession` → `undefined` → `NO_SESSION` error frame, `pushBatch` never called → RED.
  - `[RED until spec 10-bio-ingest-to-root]` should reject a batch whose `session_id` is a child id (≠ root) with code `SESSION_MISMATCH`. Stub `ensureRoot` → `makeRoot({ id: 'root-1' })`; send `makeBatch('child-9')`; assert `frame.error.code === 'SESSION_MISMATCH'` and `pushBatch` not called. Today → `NO_SESSION` → RED.
  - `[RED until spec 10-bio-ingest-to-root]` should emit `NO_ROOT_SESSION` when `ensureRoot` yields nothing. Stub `ensureRoot` → `undefined`; send `makeBatch('root-1')`; assert `frame.error.code === 'NO_ROOT_SESSION'` (P3). Today → `NO_SESSION` → RED.
  - `[RED until spec 10-bio-ingest-to-root]` should accept a batch for a live root regardless of `isPaused` (pause does not block bio — P5 forward invariant). Stub `ensureRoot` → `makeRoot({ id: 'root-1', isPaused: true })`; send `makeBatch('root-1')`; assert the first non-ready frame is an `ack` (not an error) and `pushBatch` was called. Today → `NO_SESSION` error → RED.

- [x] **Task 4: Add batch-consistency smoke characterization** (depends on Task 3)
  Files: `src/realtime/module-biometric-stream.grpc.controller.spec.ts`
  Add a `describe('streamData — batch consistency (smoke, characterization)')` block. These steps run **before** root resolution (controller `:90-114`), so they are unaffected by spec 10 and must stay GREEN. Assert each code **once** (loud paths — do not over-test, note 21 L1 / validation-order pin); drive via `firstNonReadyFrame`:
  - `[characterization — must stay GREEN]` empty batch → `error.code === 'INVALID_ARGUMENT'` (send `{ samples: [] }`).
  - `[characterization — must stay GREEN]` missing sessionId (`sessionId === ''`) → `'INVALID_ARGUMENT'`.
  - `[characterization — must stay GREEN]` inconsistent sessionId across samples → `'INVALID_ARGUMENT'` (two samples, differing `sessionId`).
  - `[characterization — must stay GREEN]` missing sampleType (`sampleType === ''`) → `'INVALID_ARGUMENT'`.
  - Do NOT assert branch order or count — one code per case (L1).

### Phase 2: Engine — id-agnostic flush/lifecycle characterization (extend `biometric-stream-engine.service.spec.ts`)

- [x] **Task 5: Add/strengthen engine lifecycle + overflow characterization** (depends on Task 4)
  Files: `src/realtime/services/biometric-stream-engine.service.spec.ts`
  Per P4 these are **characterization (GREEN now)** — they prove the engine already buffers per arbitrary id and flushes per id, guarding spec 10/04 against breaking that. Reuse the existing `makeRepo`/`makeBioSample`/`makeConfig` harness. Add the cases that are gaps (skip any already present):
  - `[characterization — must stay GREEN]` flushes and clears the per-root buffer on root ABANDONED. `pushBatch('root-1', [sample]); await engine.onSessionAbandoned({ sessionId: 'root-1' });` assert `repo.save` called once, then a follow-up `flush('root-1')` saves nothing (buffer cleared). (Distinct from the existing `flush`-spy coexistence char at `:249-261` — this asserts the real save+clear.)
  - `[characterization — must stay GREEN]` flushes the per-root buffer on REVOKED. `pushBatch('root-1', [sample]); await engine.onSessionRevoked({ sessionId: 'root-1' });` assert `repo.save` called once and buffer cleared.
  - `[characterization — must stay GREEN]` a child COMPLETED is a harmless no-op when the child owns no buffer. `pushBatch('root-1', [sample]); await engine.onSessionCompleted({ sessionId: 'child-9' });` assert `repo.save` NOT called and the `'root-1'` buffer is intact (a later `flush('root-1')` still saves). This is the "child completion no longer carries bio" guarantee (note 21 / note 10 §flush handlers).
  - `[characterization — must stay GREEN]` overflow increments `dropped_count` without breaking temporal density (continue-not-break, `:113-119`). Push a single batch of `[accepted, oversized, accepted]` where the middle sample exceeds the byte cap; assert `acceptedCount === 2` and `droppedCount === 1` — both neighbours survive the drop (the existing `:75-88` test only drops a lone sample; this proves the loop continues). Assert via the returned counters only (L1 — never `buffer.byteSize`).

### Phase 3: Verify the TDD signal

- [x] **Task 6: Run both specs, confirm RED/GREEN, record Findings** (depends on Task 5)
  Files: `src/realtime/module-biometric-stream.grpc.controller.spec.ts`, `src/realtime/services/biometric-stream-engine.service.spec.ts`, `.ai-factory/notes/21-test-bio-ingest-to-root.md`
  Run `npx jest src/realtime/module-biometric-stream.grpc.controller.spec.ts src/realtime/services/biometric-stream-engine.service.spec.ts`. Confirm: every characterization case is GREEN (smoke + engine lifecycle + overflow + the untouched auth/legacy-pause blocks), and every `[RED until spec 10-bio-ingest-to-root]` case is RED **for the right reason** — the controller still resolves via `getActiveSession` so it emits `NO_SESSION`/never calls `pushBatch(root.id)`, **not** a compile error, a hang, or a wrong-mock artifact (P6 must hold). Append any ambiguity discovered during authoring (e.g. spec 10 choosing `getRoot`/`ActivityState` over `ensureRoot`/`ModuleSession`, or a root-lifecycle gap in spec 04) to the note's **Findings**, escalating to spec 10 before it is implemented.

## Commit Plan
- **Commit 1** (after tasks 1–3): "Add root-binding target tests for bio ingest controller"
- **Commit 2** (after tasks 4–6): "Add batch-consistency smoke and engine flush characterization for bio ingest"

## Notes
- Roadmap linkage (non-blocking WARN): this milestone sits under "Test coverage — TDD, silent-bug-first" (ROADMAP line 23); its feature `10-bio-ingest-to-root` is Phase 58. The RED-until references resolve to that backlog item.
- Do not touch the existing auth tests (`:91-110`) or the legacy pause pass-through tests (`:114-209`) — the latter are flagged for spec 10 to migrate (P5), not for this milestone to edit.
