# Code Review — Tests: multi-session lifecycle state machine (review 2)

**Branch:** `feature/root-session`
**Deliverable under review:** `src/realtime/services/multi-session-lifecycle.spec.ts` (now 768 lines, down from 811) — the only source change. The other staged files are `.ai-factory/` docs (plan, plan-reviews, note Findings, ROADMAP, review-1) with no runtime risk.

## What changed since review 1 (verified)
Review-1's **finding 1** (Medium) — characterization tests locking the userId-keyed grace-timer internals that spec 03 deliberately re-keys — is **resolved**:
- The four store-level `startGraceTimer('user-1')` / `hasPendingGraceTimer('user-1')` characterization tests are removed, replaced by a comment (lines 145–149) that correctly explains *why* (timers re-key to sessionId at Phase 55; userId-keyed assertions would go RED for the intended reason and trip the file's own "escalate, never patch" contract), and defers that coverage to `activity-session-store.service.spec.ts`.
- The intermediate `expect(store.hasPendingGraceTimer('user-1'))` assertions inside the disconnect→grace→abandon (was line 382) and disconnect→reconnect (was 435/451) flows are removed. Those flows now assert only the **observable outcome** (status transition, store cleared, ABANDONED emitted / not emitted) — exactly the review-1 recommendation.

The remaining direct store usage in characterization is `store.set/get/has(userId)`, which note 16 explicitly designates as the store *characterization* case ("preserve single-child get/set/delete semantics") — so it is contract-consistent.

## Verification performed
- Read the new file in full and the units it drives (`activity-engine.service.ts`, `activity-session-store.service.ts`).
- **Ran both subsets.** Characterization: `9 passed` (GREEN). Target: `8 failed`, every one with `TypeError: <member> is not a function` (`store.addChild` / `startGraceTimerForSession` / `setRoot`, `engine.ensureRoot`) — red because the feature is absent, not because of a test defect. ✓
- Confirmed the disconnect→grace→abandon positive flow drains correctly (advance 1000ms + two microtask flushes complete `findOne`→`save` before the assertions). ✓
- Confirmed the Long-branch end-path fixture uses `clientEnd = startedAt + 8s` (≥ startedAt), exercising the Long branch rather than the server-now fallback. ✓

No compile error, no runtime crash, no migration owed (test-only deliverable).

## Findings (all Low / non-blocking)

### 1. (Low) `ensureRoot` target test won't flip GREEN from the engine implementation alone — the `rootRow` fixture omits `rootSessionId: null`
Line 684 asserts `expect((first as any).rootSessionId).toBeNull()`, but the `rootRow` fixture (lines 669–674, via `makeSession`) never sets `rootSessionId`, so the field is `undefined`, and `expect(undefined).toBeNull()` fails (`undefined !== null`). `ensureRoot` returns the saved entity, and the test mocks `repo.save` to return `rootRow` — so even once Phase 55 implements `ensureRoot`, this assertion stays RED until the fixture (or the returned row) carries `rootSessionId: null`. It is correctly RED today for the top-level reason (method absent), so this doesn't affect the current contract — but it means the test can't cleanly turn green from spec-04 code alone; the Phase 55 implementer will have to touch the fixture. Pre-empt it: add `rootSessionId: null` to the `rootRow` fixture (and the `childRow` linking fixtures, which similarly lack the column the linking assertion reads at line 720/724).

### 2. (Low) The reconnect-in-grace characterization test no longer proves timer cancellation — the surviving negative assertion is masked by the abandon status-guard
After the review-1 fix, `disconnect→reconnect-in-grace→resume` (390–422) asserts (a) the session is resumed to ACTIVE and (b) ABANDONED is never emitted after advancing past the original deadline. Assertion (b) cannot actually detect a *leaked / mis-cancelled* grace timer: even if reconnect failed to cancel the timer, when it fires `abandonActivity` reads the now-ACTIVE row and the guard (`status !== DISCONNECTED → return`, activity-engine.service.ts:197–200) short-circuits **without emitting** — so ABANDONED is absent whether or not the timer was cancelled. The genuinely meaningful surviving assertion is therefore "resume → ACTIVE"; the timer-cancellation behavior is *not* covered here.

This is an acceptable consequence of the review-1 tradeoff (dropping userId-keyed timer assertions to survive the re-keying), not a regression — but it leaves a coverage gap on exactly one of the milestone's named silent bugs ("a grace timer keyed to the wrong id" / mis-cancel). Cancellation is best asserted in the sessionId-keyed store spec post-Phase-55, or as a target test that checks `hasPendingGraceTimerForSession` is cleared on reconnect (the file already does the latter at lines 628–634 in the target block). Worth a one-line comment on the characterization test noting that cancellation coverage lives in the target/store specs, so a future reader doesn't mistake this for cancellation coverage.

### 3. (Nit) Negative assertion under-flushes relative to the async abandon path
Line 416 flushes once (`await Promise.resolve()`) before asserting ABANDONED was not emitted, whereas the abandon path has two awaits (`findOne`, `save`). Given finding 2 (the guard prevents emission anyway) this is harmless today, but if the test is ever strengthened to rely on draining the abandon path, match the two-flush pattern used in the positive disconnect→grace→abandon test (lines 362–363).

## Positive notes
- The review-1 fix is surgical and correct: the problematic userId-keyed timer assertions are gone, the rationale is documented in-file, and the flows now assert observable outcomes that genuinely survive the Phase 55 re-keying.
- Empirically verified: characterization is GREEN (9), targets are RED for the right reason (8, all `is not a function`), no `.skip`/`.todo`/`it.failing` suppression.
- The Long-branch end-path fixture honors the `clientEnd >= startedAt` guard; the disconnect→grace→abandon positive flow flushes adequately; the wrapper-helper boundary (`disconnect` → `handleTransportDisconnect`, `reconnect` → `handleReconnect`) is intact.
- Target tests double as the spec-03/04 API contract (`addChild`/`getChild`/`listChildren`/`setRoot`/`getSoleChild`/`hasPendingGraceTimerForSession`/`ensureRoot`) with consistent, self-documenting names.

## Verdict
Review-1's blocking-class finding is resolved; the deliverable compiles, characterization is GREEN, and targets are RED for the right reason. The three findings above are all **Low / non-blocking** — finding 1 is the only one with concrete future bite (a one-line fixture fix so the `ensureRoot` test flips green cleanly at Phase 55) and is worth doing now; findings 2–3 are coverage-boundary clarifications. None block using this file as the Phase 55 safety net.
