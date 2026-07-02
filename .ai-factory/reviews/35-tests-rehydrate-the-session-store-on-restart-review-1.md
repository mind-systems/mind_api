# Code Review: Tests — rehydrate the session store on restart

**Scope of change:** one code file — `src/realtime/services/startup-recovery.service.spec.ts` (the other staged files are planning artifacts: `.md`/`.json` under `.ai-factory/`, no runtime surface).
**Nature:** TDD, committed-RED. Target cases are expected to fail against today's service and turn GREEN when feature note 26 lands.

## What I verified

**Compiles and behaves as designed.** Ran `npx jest src/realtime/services/startup-recovery.service.spec.ts`: **7 failed, 1 passed**. The file compiles under ts-jest, the characterization case (`does not call repo.save… when repo.find is empty`) stays GREEN, and all 7 target cases are genuinely RED. This is the intended state per the plan/notes.

**No false-GREEN target cases.** Each target assertion fails against today's bulk-abandon service for the right reason (store/engine methods never called; rows saved as `ABANDONED` not `DISCONNECTED`), so every case will actually exercise note 26's implementation rather than pass vacuously.

**Type/entity fidelity (checked against source):**
- `makeSession` returns a `ModuleSession` object literal with every required field present (`id`, `userId`, `rootSessionId`, `activityType`, `status`, `startedAt`, `disconnectedAt`, `lastActivityAt`, `createdAt`) — matches `module-session.entity.ts`. No `as` cast needed; it compiles cleanly.
- `makeSampleRow` produces the **real** persisted sample shape `{ timestamp, data: { dataType: 'session_event', event } }` (`interfaces/session-buffer.interface.ts` + push site `activity-engine.service.ts:342-348`), not note 29's simplified `{ event, timestamp }`. Correct.
- `ActivityType.ROOT` exists (`activity-type.enum.ts:4`); `SessionStatus.ACTIVE/DISCONNECTED/ABANDONED` all exist.

**Contract fidelity vs. existing machinery:**
- The grace-arming case asserting a timer for **both** the root and each child — with `onExpiry` → `engine.abandonActivity(userId, sid)` — matches the existing `handleTransportDisconnect` loop (`activity-engine.service.ts:672-692`), which arms `[rootId, ...childIds]` and abandons on expiry. The test does **not** over-constrain the root; arming a per-session grace timer for the root is the established behavior.
- `abandonActivity(userId, sessionId)` (2-arg) matches `activity-engine.service.ts:316`.
- `startGraceTimerForSession(sessionId, onExpiry)` and `setRoot/addChild/getRootId` signatures match `activity-session-store.service.ts`.

**Robust assertions:**
- `collectPersistedRows` flattens both `repo.save` (array or single) and `repo.update` (arg[1]) calls, so the DISCONNECTED-marking assertion holds regardless of which persistence call note 26 chooses. Good future-proofing.
- Pause-derive fixtures list markers in agreement between array order and timestamp order (`resumed@1000, paused@2000`), so the case is robust to either a "last array element" or "max timestamp" derive strategy.
- The `as any` constructor and its `no-unsafe-*` disables are correctly scoped; `service` keeps its declared `StartupRecoveryService` type so method calls stay type-checked.

## Notes (not findings)

- This commit intentionally leaves the suite failing (7 RED). CI running `npm test` will report failures until note 26 lands — that is the documented committed-RED design of this milestone, not a defect. The DB restart round-trip and no-duplicate-root guard are correctly left to the manual checklist rather than unit-tested.

No correctness, security, or type-safety issues found in the code change.

REVIEW_PASS
