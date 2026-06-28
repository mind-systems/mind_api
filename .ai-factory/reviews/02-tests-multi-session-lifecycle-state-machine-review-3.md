# Code Review — Tests: multi-session lifecycle state machine (review 3)

**Branch:** `feature/root-session`
**Deliverable under review:** `src/realtime/services/multi-session-lifecycle.spec.ts` (now 782 lines) — the only source change. Remaining staged files are `.ai-factory/` docs (plan, plan-reviews, note Findings, ROADMAP, reviews 1–2) with no runtime risk.

## What changed since review 2 (all three findings resolved — verified)
- **Finding 1 (ensureRoot fixture omitted `rootSessionId: null`).** Fixed: `rootRow`/`childRow` fixtures now set `rootSessionId` explicitly (lines 683, 713, 719, 744, 750). Because the `rootSessionId` column does not exist on `ModuleSession` until Phase 54, each fixture object is cast `as any` (lines 684, 714, 720, 745, 751) so the excess-property check is suppressed — the file still compiles cleanly. `expect((first as any).rootSessionId).toBeNull()` will now pass once `ensureRoot` lands, instead of failing on `undefined`. ✓
- **Finding 2 (reconnect test doesn't prove timer cancellation).** Fixed: a comment (lines 414–420) now documents that the "ABANDONED not emitted" assertion does not prove cancellation (the abandon status-guard masks a leaked timer) and points to where cancellation coverage actually lives — the sessionId-keyed target block and the post-Phase-55 store spec. ✓
- **Finding 3 (negative assertion under-flushed).** Fixed: the reconnect test now flushes twice (lines 422–423), matching the abandon path's two awaits. ✓

## Verification performed
- Read the new file in full (third pass) and the units it drives (`activity-engine.service.ts`, `activity-session-store.service.ts`); re-checked the `as any` excess-property casts compile and do not mask the assertions under test (the casts are on fixture *construction*; the assertions read the resulting objects through separate `as any` reads).
- **Ran the full file.** Result: `Tests: 8 failed, 9 passed`. The 9 passing are the characterization GREEN set; the 8 failing are the target RED set, each failing with `TypeError: <member> is not a function` (`store.addChild` / `startGraceTimerForSession` / `setRoot`, `engine.ensureRoot`) — red because the feature is absent, exactly the intended TDD state, not a test defect. The suite-level "1 failed" is those intended target reds, which the plan and ROADMAP explicitly accept until Phase 55.

No compile error, no runtime crash, no migration owed (test-only deliverable), no boundary/dependency violation (stays inside the `realtime` module's own service specs).

## Residual notes (no action required — inherent to the red-first design)
- Several target tests call the engine directly without the wrapper helpers (`engine.startActivity('user-1', …)`, `engine.endActivity('user-1')`, `(engine as any).ensureRoot(...)`). When Phase 55 threads an explicit `sessionId` through those signatures, these target tests will need the routine touch-up that turns a red target green — this is the established and acknowledged behavior of target tests, not a defect. The characterization flows remain insulated behind the `makeHelpers` wrappers, which is what matters for distinguishing a real regression from a mechanical signature change.
- The fixture `as any` casts suppress all excess-property/type checking on the override object (not just `rootSessionId`), so a future typo in a fixture field would be silently ignored. This is an unavoidable consequence of asserting on a column that cannot be typed until Phase 54; acceptable, and localized to fixture construction.

## Positive notes
- The red/green machinery is correct and verified end-to-end: characterization is genuinely GREEN (9), targets are RED for the right reason (8, all `is not a function`), no `.skip`/`.todo`/`it.failing` suppression.
- Review-1's blocking finding (characterization locking the userId-keyed grace-timer keying that Phase 55 inverts) and all of review-2's Low findings are fully addressed; the iteration history shows each fix was surgical and left the rest of the contract intact.
- The wrapper-helper insulation, the `coerceClientTs` Long-branch end-path guard (`clientEnd >= startedAt`), the adequately-flushed async abandon flows, and the self-documenting target-API names (`addChild`/`getChild`/`listChildren`/`setRoot`/`getSoleChild`/`hasPendingGraceTimerForSession`/`ensureRoot`) are all sound.

## Verdict
All findings from reviews 1 and 2 are resolved; no new defects. The file compiles, characterization is GREEN, and the target tests are RED strictly because their Phase 55 feature is absent — the intended done-state for this test-first milestone. (Note for the gate: this deliverable intentionally leaves `npm test` red via the 8 target tests; that is by design per the plan and ROADMAP, and `REVIEW_PASS` here attests the test *code* is correct, not that the suite is green.)

REVIEW_PASS
