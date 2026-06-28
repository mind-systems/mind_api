# Code Review — Tests: multi-session lifecycle state machine (review 1)

**Branch:** `feature/root-session`
**Deliverable under review:** `src/realtime/services/multi-session-lifecycle.spec.ts` (new, 811 lines) — the only source change. Other staged files are `.ai-factory/` docs (plan, plan-reviews, note Findings, ROADMAP) and carry no runtime risk.

## Verification performed
- Read the new spec file in full and the units it exercises (`activity-engine.service.ts`, `activity-session-store.service.ts`), plus specs 03/04 and note 16 to validate the red/green classification.
- **Ran the suite.** Characterization: `13 passed` (GREEN, as required). Target: `8 failed`, every one with `TypeError: <member> is not a function` (`store.addChild`, `store.startGraceTimerForSession`, `store.setRoot`, `engine.ensureRoot`) — i.e. red because the feature is absent, not because of a test defect. This is exactly the "red-for-the-right-reason" the contract demands. ✓
- Confirmed the wrapper `disconnect` → `handleTransportDisconnect` (schedules the grace timer), `reconnect` → `handleReconnect`; both characterization grace flows fire/cancel correctly under fake timers. ✓
- Confirmed the `coerceClientTs` Long-branch end-path fixture uses `clientEnd = startedAt + 8s` (≥ startedAt), so it exercises the Long branch rather than the server-now fallback. ✓

No runtime crash, no migration owed (test-only deliverable), no type errors — the file compiles and runs.

## Findings

### 1. (Medium) Several "characterization" assertions lock the **userId-keyed grace-timer** internals that spec 03 deliberately inverts — they will go RED at Phase 55 for a *legitimate* reason, tripping the file's own "red = escalate, never patch" contract

The file header declares characterization tests must stay GREEN through Phase 55 and that "Any RED here after the Phase 55 refactor is a Class B silent regression — escalate immediately, do NOT patch the test." But spec 03 is explicit (note `03-multi-session-store-engine`, lines 8/27): grace timers become `Map<sessionId, Timeout>` and `handleTransportDisconnect` starts **a per-session timer**. So the userId-keyed timer surface (`startGraceTimer(userId)` / `hasPendingGraceTimer(userId)`) is precisely what the refactor removes/re-keys.

These characterization tests assert on that userId-keyed surface directly:
- Store block, lines **146–183**: `store.startGraceTimer('user-1', …)` + `store.hasPendingGraceTimer('user-1')` (4 tests).
- Engine flows, lines **382, 435, 451**: `expect(store.hasPendingGraceTimer('user-1'))…` inside disconnect→grace→abandon and disconnect→reconnect.

After Phase 55 the grace timer for a disconnected session is keyed by `sessionId` (`'session-1'`), so `hasPendingGraceTimer('user-1')` returns `false` (or the method is gone → compile error). Either outcome turns these GREEN tests RED — but that RED is the *intended* re-keying, **not** a Class B regression. The contract then tells the Phase 55 implementer to "escalate, do not patch," which is the wrong instruction for a deliberate API change, and creates exactly the kind of false-signal friction this milestone exists to prevent.

Note that note 16's own classification (lines 22–34) lists only **"preserve single-child get/set/delete semantics"** as the store *characterization* case — and lists *"key grace timers by sessionId, not userId"* as a **target→03**. The userId-keyed grace-timer assertions added here are scope beyond what note 16 designated as characterization, and they collide with the target the same file (correctly) marks RED at lines 219–247.

Why this matters: the wrapper-helper insulation (the plan's central technique for surviving the refactor) only covers the *engine method calls*. These assertions reach **past** the helper boundary to check userId-keyed store/timer state directly, so the insulation does not protect them — the very gap the plan's design was meant to close.

Recommended fix (no behavior change to the engine, test-only):
- Route timer-presence checks through a helper too — e.g. `pendingTimer(sessionId)` that today calls `store.hasPendingGraceTimer(userId)` and post-Phase-55 calls `hasPendingGraceTimerForSession(sessionId)` — so only the helper body absorbs the re-keying; **or**
- In the engine characterization flows, drop the intermediate `hasPendingGraceTimer('user-1')` assertions and assert only the observable outcome that genuinely is preserved (after advancing past grace → ABANDONED emitted / store cleared; after reconnect-in-grace → no ABANDONED). The outcome is behavior-preserving; the timer *key* is not.
- For the store-level grace-timer tests (146–183): either move them under the `target` block (they describe the timer mechanism the refactor changes) or delete them as redundant with the existing `activity-session-store.service.spec.ts`, which already owns the store's own unit coverage and will be updated by the Phase 55 implementer.

### 2. (Low) Store-level characterization duplicates `activity-session-store.service.spec.ts`

Lines 135–183 restate set/get/has/delete and grace-timer assertions already covered in full by the existing store spec. The get/set/delete round-trip (135–144) is harmless duplication (note 16 mandates those semantics survive). The grace-timer duplicates (146–183) carry the finding-1 risk on top of being redundant. Prefer keeping the store's own unit behavior in its own spec and letting this file focus on the *cross-service state-machine* contract (the engine flows + multi-session/root targets), which is its stated reason to span two services.

### 3. (Nit) `repo.findOne` mock destructures `{ where: { id } }` without a null guard
Lines 661 and 787 use `({ where: { id } }) => …`. Current engine call sites always pass `{ where: { id } }` (or `{ id, userId }` in `handleReconnect`), so this is fine today. If a future call passes `{ where: { id, userId } }` the `id`-only match still works, but a call without `where` would throw inside the mock. These tests are RED-at-seeding today regardless; just flagging so the Phase 55 implementer broadens the matcher if `handleReconnect`'s `{ id, userId }` lookup starts flowing through these mocks.

## Positive notes
- The red/green machinery works end-to-end as designed: characterization is genuinely GREEN now, targets fail with `is not a function` (feature-absent), no `.skip`/`.todo`/`it.failing` suppression — verified by running both subsets.
- The disconnect→grace→abandon async/fake-timer handling (advance, then two microtask flushes) is correct: the two `await Promise.resolve()` drain the `findOne`/`save` awaits in `abandonActivity` before the assertions run.
- The Long-branch end-path fixture honors the `clientEnd >= startedAt` guard, so it proves the `.toNumber()` branch rather than passing via the server-now fallback — the precise gotcha raised in plan-review 2.
- Target tests double as the spec-03/04 API contract (`addChild`/`getChild`/`listChildren`/`setRoot`/`getSoleChild`/`hasPendingGraceTimerForSession`/`ensureRoot`); naming is consistent and self-documenting.

## Verdict
No blocking runtime defect — the deliverable compiles, characterization is GREEN, targets are RED for the right reason. But **finding 1 is a real correctness problem in the test *contract***: a subset of characterization assertions locks the userId-keyed grace-timer keying that spec 03 is chartered to change, so they will misfire as "regressions" at Phase 55 and mis-route the implementer per this file's own escalation rule. Address finding 1 (and ideally 2) before this is relied on as the Phase 55 safety net.
