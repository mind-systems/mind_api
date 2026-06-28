# Test plan — bio ingest bound to root (silent-bug-first, TDD)

**Date:** 2026-06-28
**Source:** conversation context (test philosophy from /roadmap-test-coverage)

Covers feature task [[10-bio-ingest-to-root]].

## Test authoring constraints (the four lessons)
- **L1 — outcomes only:** batch-consistency rejections assert the emitted error `code` string on the captured subscriber, not the validation branch order. Overflow asserts the OUTCOME counter (`ack.droppedCount` / `result.totalDropped`), never the internal `BioSessionBuffer` `byteSize`/`samples` structure. "Pushed with root.id" asserts `streamEngine.pushBatch` was called with `root.id` (the resolved owner), not the buffer map.
- **L2 — compile-now:** `activityEngine.ensureRoot(userId)` does not exist yet (only `getActiveSession`, `activity-engine.service.ts:401`) — stub/access via `(engine as any).ensureRoot` (resolves a `ModuleSession | undefined` promise). Root fixtures use `activityType: 'root' as any`.
- **L3 — label by spec name:** target cases `RED until spec 10-bio-ingest-to-root`; never a phase number.
- **L4 — escalation valve:** the batch-consistency and overflow cases are characterization invariants. A RED there post-spec-10 = genuine Class-B regression, escalate. Routing-to-root cases are target, expected RED now.

## Why this area (silent-failure filter)
Most validation here fails loudly (`SESSION_MISMATCH`, `NO_ROOT_SESSION`, batch-consistency errors) — those are low-priority. The **silent** parts: pushing the batch with the wrong owner id (bio attributed to a child instead of the root → invisible to the windowed read), and the flush no longer firing on the right lifecycle event (buffered bio silently lost on root teardown). Test those; the loud error paths only need a smoke check.

## Behavior under change — think hard before writing
Ingest moves from "active child" to "user's root". Trace what happens to bio when a child completes (was: flush+clear child buffer; now: child never owned a buffer — the COMPLETED handler must be a harmless no-op) and when the root is abandoned/revoked (must flush). Confirm the engine, keyed by an arbitrary sessionId, actually buffers per-root once `root.id` is passed. Any lifecycle gap → **Findings**.

## Red/Green contract
- **Target (RED until [[10-bio-ingest-to-root]]):** root resolution + flush-on-root-lifecycle.
- **Characterization (GREEN, stay GREEN):** batch-consistency rules (empty batch, missing/inconsistent sessionId, missing sampleType) still reject with the same codes; the engine's ring-buffer drop/`dropped_count` accounting on overflow is unchanged.

## Instantiation
`ModuleBiometricStreamGrpcController` with mocked `BiometricStreamEngine`, `ActivityEngine` (`ensureRoot` stub, `jest.fn().mockResolvedValue(...)`), `ActiveStreamRegistry`; drive a fake batch `Observable` and capture `BioStreamResponse` on a fake subscriber. `BiometricStreamEngine` separately with a mocked `Repository<BioSessionSample>` for flush/lifecycle.

## Test cases
### Routing
- should resolve the user's root and call `pushBatch(root.id, …)` — target→10
- should reject a batch whose `session_id` is a child id (not the root) with code `SESSION_MISMATCH` — target→10
- should reject with code `NO_ROOT_SESSION` when the user has no root — target→10
### Lifecycle flush
- should flush + clear the per-root buffer on root ABANDONED — target→10
- should flush on REVOKED (closeAll) — target→10
- should be a harmless no-op on a child COMPLETED (child owns no bio buffer) — target→10
### Unchanged
- should still reject empty / inconsistent-sessionId / missing-sampleType batches — char
- should still increment `dropped_count` on buffer overflow without breaking temporal density — char

## Exact pins (read from source)
- **Error codes are LITERAL strings in the controller, NOT via `WsErrorCode`:** `module-biometric-stream.grpc.controller.ts` emits `'INVALID_ARGUMENT'` (empty batch line 92; missing sessionId 98; inconsistent sessionId 106; missing sampleType 113), `'NO_SESSION'` (line 119), `'SESSION_MISMATCH'` (line 125-128), `'INTERNAL_ERROR'` (line 165). Assert these exact literals on `error.code`. `NO_ROOT_SESSION` already exists in `ws-error-codes.ts:4` (`'NO_ROOT_SESSION'`) — spec 10 will emit it when `ensureRoot` resolves to `undefined` (replacing the `getActiveSession` → `'NO_SESSION'` check at lines 117-119). Assert the literal `'NO_ROOT_SESSION'`.
- **Validation order (smoke only, char):** empty → missing sessionId → inconsistent sessionId → missing sampleType → no session → mismatch (controller lines 90-130). These are loud paths; assert each code once, don't over-test.
- **Overflow counter (char):** `pushBatch` returns `{ acceptedCount, droppedCount, totalReceived, totalDropped }` (`biometric-stream-engine.service.ts:77-133`); on per-sample cap it does `buffer.totalDropped += 1; droppedCount += 1; continue` (lines 113-119) — does NOT break. The controller surfaces `ack.droppedCount = result.totalDropped` (`module-biometric-stream.grpc.controller.ts:144-148`). Assert `ack.droppedCount` reflects the overflow; do not inspect `buffer.byteSize`.
- **Lifecycle flush keyed by sessionId:** `@OnEvent(ABANDONED/REVOKED/COMPLETED/INTERRUPTED)` each do `await flush(payload.sessionId); buffers.delete(payload.sessionId)` (`biometric-stream-engine.service.ts:204-250`). For the root flush to fire, the root must emit ABANDONED/REVOKED with its OWN id (depends on [[04-lazy-root-creation]] root lifecycle). A child COMPLETED is a harmless no-op because the child never owned a buffer (spec 10 ingests under root.id) — assert `flush(childId)` finds an empty/missing buffer and saves nothing.
- **Controller resolution today:** `getActiveSession(userId)` then `session.sessionId !== batch.samples[0].sessionId` → mismatch (controller lines 116-130). Spec 10 swaps to `await ensureRoot(userId)` (handleBatch becomes async) and compares against `root.id`.

## Instantiation
`ModuleBiometricStreamGrpcController(streamEngine, activityEngine, activeStreamRegistry)` (3 ctor args, `module-biometric-stream.grpc.controller.ts:33-37`). Drive `streamData` with a fake batch `Observable`, capture `BioStreamResponse` on a fake subscriber; or call the private `handleBatch(userId, batch, subscriber)` via `(controller as any).handleBatch`. Separately, `BiometricStreamEngine(sampleRepo, moduleSessionRepo, configService)` (3 ctor args, lines 33-39) with mocked repos for flush/lifecycle.

## Gotchas
- The engine's `@OnEvent` handlers are keyed by sessionId — they fire for the root only if the root emits ABANDONED/REVOKED with its own id (depends on [[04-lazy-root-creation]] root lifecycle).
- `pushBatch` continues (not breaks) on a per-sample overflow — preserve that assertion.
- Pause does not block bio — assert a batch is accepted for a live root regardless of `isPaused`.

## Findings

### Pins P1–P6 — test↔feature contract (agreed before authoring target cases)

These pins are the shared contract between this test milestone and feature spec [[10-bio-ingest-to-root]]. Target cases are written against these pins so they flip GREEN when spec 10 lands instead of staying RED for the wrong reason. If spec 10 cannot honor a pin, the test author re-pins here first.

**P1 — resolution mechanism is `ensureRoot`, not `getRoot`.**
Note 10's locked decision is that a bio-only connection **creates** a root (`await this.activityEngine.ensureRoot(userId)`), so `handleBatch` becomes **async** and the resolved owner is (almost) never null. Note 21's original framing ("`getRoot` stub") is **superseded** — `getRoot` does not exist on `ActivityEngine`; the correct stub is `ensureRoot: jest.fn()` accessed `(engine as any).ensureRoot` since the method does not exist yet (compile-now, L2). `NO_ROOT_SESSION` is emitted **only** in the unexpected case where `ensureRoot` itself yields nothing (note 10 §Decisions).
→ **Spec 10 must honor:** add `ensureRoot(userId): Promise<ModuleSession | undefined>` to `ActivityEngine`; make `handleBatch` async; emit `NO_ROOT_SESSION` only when `ensureRoot` returns `undefined`.

**P2 — owner id field is `root.id`.**
`ensureRoot` returns a `ModuleSession`, so push and compare against `root.id` (not `root.sessionId`); `ack.sessionId === root.id`.
Carve-out: if spec 10 instead forwards a store `ActivityState`, re-pin here and the field is `.sessionId`.

**P3 — error codes are literal strings.**
The new no-root branch emits `WsErrorCode.NO_ROOT_SESSION`, whose value is the literal `'NO_ROOT_SESSION'` (`ws-error-codes.ts:4`), **replacing** the old literal `'NO_SESSION'` at step 5. `SESSION_MISMATCH` stays the literal `'SESSION_MISMATCH'`; steps 1–4 stay `'INVALID_ARGUMENT'`. Assert these exact strings on `frame.error.code` (today the controller emits literals, not `WsErrorCode.*` — confirmed from source).

**P4 — the engine is structurally unchanged (note 10 §Engine), so its flush/lifecycle cases are CHARACTERIZATION (GREEN now), not target.**
`pushBatch` is keyed by an arbitrary `sessionId` and the four `@OnEvent` handlers already flush+clear by `payload.sessionId` (`biometric-stream-engine.service.ts:86,204-250`); passing `root.id` makes the buffer per-root automatically, and `doFlush` already no-ops a missing buffer (`:150-157`). Therefore the engine lifecycle cases are **reclassified to characterization** — written at the engine they are GREEN now and guard spec 10/04 against breaking the engine's id-agnostic flush. The genuine **target (RED-until-10) silent signal lives at the controller**: that `streamEngine.pushBatch` is called with `root.id` (the resolved owner).
→ **Spec 10 must honor:** do not change the engine's `@OnEvent` flush mechanism or the id-agnostic buffer key.

**P5 — the legacy pause pass-through chars are coupled to the retired mechanism.**
The existing tests at `module-biometric-stream.grpc.controller.spec.ts:114-209` stub `getActiveSession` and send a batch carrying the **child** sessionId. Spec 10 swaps step 5 to `ensureRoot`, so those tests will false-RED unless spec 10 migrates them.
→ **Spec 10 must honor:** migrate the legacy `getActiveSession` pause chars to use `ensureRoot`.
Here, the pause invariant ("pause does not block bio") is re-expressed as a **forward target** test against a live root (RED until spec 10).

**P6 — two-state observability mechanism.**
Drive through `streamData(request$, user)` and assert the **first non-`ready` response frame** (ack or error), not a `done()` that waits only for an ack. Today the controller still calls `getActiveSession` (→ `undefined` → emits a `NO_SESSION` error frame, never an ack), so a forward target asserting an ack would **timeout/hang** rather than fail cleanly. Capturing the first non-ready frame yields a clean RED today (wrong code / error-instead-of-ack) and GREEN after spec 10 — never a hang.

### Run results (Task 6 — TDD signal verified)

Run: `npx jest src/realtime/module-biometric-stream.grpc.controller.spec.ts src/realtime/services/biometric-stream-engine.service.spec.ts`

**Engine spec:** ✅ PASS — all characterization cases GREEN, including the 3 new lifecycle cases (root ABANDONED flush+clear, root REVOKED flush+clear, child COMPLETED no-op) and the mid-batch overflow temporal-density case.

**Controller spec:** 4 failures exactly as expected — all target cases:

1. `[RED] should resolve the user root and call pushBatch(root.id, …)` — `frame.ack` is `undefined` (controller emits `NO_SESSION` error frame instead of ack). ✅ RED for the right reason.
2. `[RED] should reject a batch whose session_id is a child id with SESSION_MISMATCH` — got `'NO_SESSION'`, expected `'SESSION_MISMATCH'`. ✅ RED for the right reason.
3. `[RED] should emit NO_ROOT_SESSION when ensureRoot yields nothing` — got `'NO_SESSION'`, expected `'NO_ROOT_SESSION'`. ✅ RED for the right reason.
4. `[RED] should accept a batch for a paused root` — `frame.ack` is `undefined` (controller emits `NO_SESSION` error). ✅ RED for the right reason.

**P6 holds:** no hang in any case — `firstNonReadyFrame` captures the `NO_SESSION` error frame immediately and rejects cleanly with wrong code. Clean RED, not a timeout.

All 5 characterization cases in the controller spec are GREEN:
- 4 batch-consistency smoke cases: `INVALID_ARGUMENT` for empty / missing sessionId / inconsistent sessionId / missing sampleType.
- Legacy pause pass-through and auth tests: untouched, all GREEN.

No ambiguity discovered during authoring. Escalation list below is complete.

### Escalation to spec 10

The following must be resolved **before spec 10 is implemented**:
1. (P1) Add `ensureRoot(userId): Promise<ModuleSession | undefined>` to `ActivityEngine`; make `handleBatch` async.
2. (P1) Emit `NO_ROOT_SESSION` (not `NO_SESSION`) when `ensureRoot` returns `undefined`.
3. (P2) Push and ACK using `root.id` (not a child sessionId or `root.sessionId`).
4. (P4) Do not alter the engine's id-agnostic flush or `@OnEvent` handlers.
5. (P5) Migrate the legacy `getActiveSession` pause chars (controller spec lines 114–209) to the new `ensureRoot` mechanism.
