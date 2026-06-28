# Plan Review: Tests — bio ingest bound to root

**Plan:** `.ai-factory/plans/06-tests-bio-ingest-bound-to-root.md`
**Risk Level:** 🟢 Low
**Verdict:** Solid — no blocking issues. A few non-blocking nits below.

## Scope verified
This is a TDD test-authoring milestone (no production code). I checked every load-bearing
claim in the plan and its spec note (21) / feature note (10) against the actual source:

- `module-biometric-stream.grpc.controller.ts`
- `module-biometric-stream.grpc.controller.spec.ts`
- `services/biometric-stream-engine.service.ts`
- `services/biometric-stream-engine.service.spec.ts`
- `constants/ws-error-codes.ts`

## Correctness of the plan's assumptions — all confirmed

- **Controller step structure & line numbers (P3, note 21 Exact pins):** ✅ accurate.
  Step 1 empty `:90-94`, step 2 missing sessionId `:96-100`, step 3 inconsistent `:102-108`,
  step 4 missing sampleType `:110-114`, step 5 `getActiveSession` → literal `'NO_SESSION'` `:116-121`,
  step 6 literal `'SESSION_MISMATCH'` `:123-130`. Error codes are emitted as **string literals**,
  not `WsErrorCode.*` — confirmed; `WsErrorCode` is imported nowhere in the controller.
- **`WsErrorCode.NO_ROOT_SESSION === 'NO_ROOT_SESSION'`** at `ws-error-codes.ts:4`: ✅ confirmed
  (uppercase). Asserting the literal `'NO_ROOT_SESSION'` is correct both today and post-spec-10
  (spec 10 emits `WsErrorCode.NO_ROOT_SESSION`, whose value is that literal).
- **Engine is id-agnostic (P4):** ✅ `pushBatch` keyed by the `sessionId` arg (`:86,:104`); all four
  `@OnEvent` handlers `await flush(payload.sessionId); buffers.delete(payload.sessionId)`
  (`:204,:216,:228,:240`); `doFlush` early-returns on a missing/empty buffer (`:150-157`); overflow
  is `continue`-not-`break` (`:113-119`). The reclassification of lifecycle/flush cases to
  **characterization (GREEN now)** is correct.
- **Two-state observability / P6 robustness:** ✅ `handleBatch` is synchronous today and emits the
  `NO_SESSION` error frame synchronously after `request$.next(batch)` (default `getActiveSession`
  mock returns `undefined`). Capturing the *first non-ready frame* gives a clean RED today (error,
  not ack / wrong code) and works unchanged after `handleBatch` becomes async in spec 10. No hang.
  The ordering also holds: `pushBatch` is called before the `ack` frame, so asserting
  `pushBatch('root-1', …)` once the ack is observed is sound.
- **Each target case is RED for the right reason:** ✅ verified individually — ack case (today →
  `NO_SESSION` error, `pushBatch` never called), `SESSION_MISMATCH` case (today → `NO_SESSION`),
  `NO_ROOT_SESSION` case (today → `NO_SESSION`), paused-root case (today → `NO_SESSION`). All fail
  on the asserted code/ack, none compile-error or hang.
- **Engine characterization cases would be GREEN now:** ✅ the overflow `[accepted, oversized, accepted]`
  case works under the existing harness (`maxBufferBytes:1000`) — a first ~50-byte sample, a middle
  sample with `data:'x'.repeat(>950)` exceeding the cap (dropped via `continue`), a third small
  sample re-accepted → `acceptedCount===2, droppedCount===1`. Child-COMPLETED-no-op and
  root-ABANDONED/REVOKED save+clear all match existing handler behavior.
- **Existing spec harness reuse:** ✅ `makeBatch(sessionId, sampleType='cardio')`,
  `makeActivityEngine()` (currently only `getActiveSession`), `makeRepo/makeBioSample/makeConfig`
  all exist as the plan describes. Adding `ensureRoot: jest.fn()` and `makeRoot()` is non-disruptive.

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** ✅ No boundary violation. Tests stay within the `realtime`
  module; no cross-module internal imports introduced.
- **Rules (`RULES.md`):** ⚠️ **WARN (non-blocking).** RULES.md forbids the non-null assertion
  operator (`!`). The existing controller spec already uses `values[0].ready!` (`:204`), and the
  plan's new assertions/helpers should avoid introducing more — prefer optional chaining
  (`frame.error?.code`, which P3 already mostly uses, and `frame.ack?.sessionId`). Worth calling out
  explicitly so the implementing agent doesn't reach for `!` when narrowing `frame.error`/`frame.ack`.
- **Roadmap (`ROADMAP.md`):** ✅ Linkage is accurate. The unchecked item
  "Tests: bio ingest bound to root" exists in the roadmap with spec `notes/21-…`, and the plan
  already self-declares the linkage as a non-blocking WARN.

## Non-blocking nits

1. **Line-number drift for the "do not touch" block.** The plan (and note 21) call the legacy pause
   pass-through tests `:114-209`. The `describe('streamData — pause pass-through')` block actually
   spans `:114-222` and includes the non-pause `'should register subscriber …'` test (`:211-221`).
   The instruction ("don't edit them") is unambiguous; just don't let the stale upper bound cause the
   author to append new cases *inside* that describe. Prefer adding the new `describe` blocks after it.

2. **Task 5 root-ABANDONED case overlaps an existing test.** `onSessionAbandoned flushes and removes
   buffer` already exists at `:236-246` (for `'s1'`). The new case is the same assertion with id
   `'root-1'`. The plan acknowledges it is distinct from the spy-coexistence char at `:249-261`, but
   it is near-identical to `:236-246`. Acceptable (the explicit root-id naming documents intent), just
   ensure `describe`/`it` titles don't collide and the redundancy is intentional.

3. **Overflow case depends on the existing `makeConfig` cap (1000 bytes).** The plan's oversized
   middle sample must use `data` large enough to exceed `1000 − firstSampleBytes` (~`'x'.repeat(950)`+
   as the existing `:75-88` test does). Worth pinning the exact payload size in the test so it does
   not silently become "always accepted" if defaults change.

4. **Child-COMPLETED no-op assertion ordering.** Assert `repo.save` NOT called *before* the follow-up
   `flush('root-1')` (which intentionally does save). The plan describes this order; keep it.

## Positive notes

- Strong, correct RED/GREEN discipline: each target case is justified against today's actual control
  flow, and the reclassification of engine lifecycle cases to characterization (P4) is the right call
  given the engine is genuinely id-agnostic — it avoids writing RED tests that can never go green here.
- P6's "first non-ready frame" capture is the correct fix for the real hang risk (an ack-waiting
  `done()` would time out today). This is a subtle, well-reasoned design choice.
- The cross-spec pin discipline (P1–P6, Phase 0 escalation to spec 10 before authoring) correctly
  resolves the `getRoot`/`ensureRoot` and `root.id`/`root.sessionId` divergence between notes 10 and 21
  up front, so the target cases flip GREEN for the right reason rather than staying RED on a mismatch.
- Loud-path smoke cases are correctly held to "one code per case" (no branch-order assertions),
  matching the outcomes-only constraint.

No missing migrations (test-only milestone, no schema change), no security concerns, no incorrect
file paths or API usage. The plan is implementable as written.

PLAN_REVIEW_PASS
