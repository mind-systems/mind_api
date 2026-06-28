# Plan Review — Tests: multi-session lifecycle state machine (review 2)

**Plan:** `.ai-factory/plans/02-tests-multi-session-lifecycle-state-machine.md`
**Spec:** `.ai-factory/notes/16-test-session-lifecycle-state-machine.md`
**Risk Level:** 🟢 Low — the plan is accurate against the source and has folded in most of review-1's findings. One labeling contradiction survives the revision; the rest are implementer gotchas.

## What changed since review 1 (verified incorporated)
- **CI tolerance** (review-1 finding #2) — now an explicit Red/Green bullet (line 14). ✓
- **`coerceClientTs` end-path Long gotcha** (finding #3) — now baked into Task 4 with the `clientEnd >= session.startedAt` guard and the correct line reference (`activity-engine.service.ts:128–132`). ✓
- **Rule-clean assertions / no `!`** (finding #4) — now its own Red/Green bullet (line 17) directing `expect(state).toBeDefined()` over `state!.sessionId`. ✓
- **Sole-child resolution accessor** (finding #5) — Task 3 bullet 3 reworded to make the RED classification unambiguous and explicitly distinguish it from the Task-2 characterization `get/set/delete`. ✓

## Verification performed (re-confirmed against source)
- Constructor shapes — `new ActivitySessionStore({ get: jest.fn()... } as any)` and the 4-arg `ActivityEngine(repo, store, emitter, streamEngine)` match `activity-engine.service.spec.ts` / `activity-session-store.service.spec.ts`. ✓
- Enums/events/constants — `SessionStatus` (active/disconnected/completed/abandoned/interrupted; also `resumed` exists but isn't used by these flows), `SessionEvents.{COMPLETED,ABANDONED,INTERRUPTED}`, `StreamDataType.SESSION_EVENT`, `StreamSessionEvent.{STARTED,ENDED,ABANDONED,INTERRUPTED,PAUSED,RESUMED}`, `MODULE_SESSION_PAUSED/UNPAUSED`, `ActivityType` (`breath`/`meditation` only — `root` absent). ✓
- Engine surface — `onDisconnect`, `handleTransportDisconnect`, `abandonActivity`, `abandonStale`, `stopActivity`, `pauseActivity/unpauseActivity`, `resumeActivity`, `handleReconnect`, `getActiveSession` all exist with the assumed signatures. ✓
- Abandon guard (`status !== DISCONNECTED → no save/emit, clears store`) is real (activity-engine.service.ts:197–200) → Task 4's "abandon no-ops when already resumed" is GREEN-today. ✓
- Target APIs (`ensureRoot`, `store.addChild/getChild/listChildren/setRoot`, `rootSessionId`) exist nowhere in `src/` — `(x as any)` access throws at runtime → red-for-the-right-reason. ✓
- Watchdog wiring — `abandonStale(row.userId, row.id)` called from `session-watchdog.service.ts:82`; `handleSessionRevoked` referenced in Task 7 exists in the controller. ✓
- Jest `testRegex: .*\.spec\.ts$`, `rootDir: src` → `multi-session-lifecycle.spec.ts` is picked up. ✓

## Context Gates
- **ARCHITECTURE.md** — present; the plan stays inside the `realtime` module's own service specs, no boundary/dependency conflict. No WARN.
- **RULES.md** — present. The only relevant rule (`!` ban) is now explicitly honored by the plan (line 17). The `(x as any)` compile-now casts are not covered by the rule. No WARN.
- **ROADMAP.md** — present. Both feature specs sit under **Phase 55 — Multi-session core** (lines 39–40): `03-multi-session-store-engine` and `04-lazy-root-creation`. `Phase 56` is "Proto + concurrent activities". See finding 1 — Task 6's describe label still says Phase 56. WARN.
- **skill-context/aif-review/SKILL.md** — not present; no project-specific review overrides.

## Critical Issues
None. The deliverable is test files only — no migration is owed here (`rootSessionId` column work belongs to spec 04). The intentionally-RED target blocks are by design.

## Findings (WARN / minor)

### 1. Task 6 describe label still reads `[RED until Phase 56]` — contradicts the plan's own Context and the ROADMAP (WARN — carryover from review 1, only half-fixed)
The revision fixed the Context (line 4 now says *"Phase 56 is unrelated (proto + concurrent activities), so every target block here closes when its **Phase 55** spec lands"*) and Tasks 1–5/7 reference Phase 55 / spec `04-lazy-root-creation` correctly. But **Task 6's literal describe string was missed**:

> line 66: `describe('target — ensureRoot / linking [RED until Phase 56]')`

This contradicts line 4 of the same plan and ROADMAP.md lines 39–40 (lazy-root = Phase 55). A reviewer reading the committed test output will be told the wrong feature task closes this red. Fix: change the Task 6 describe label to `[RED until Phase 55 — lazy-root-creation / spec 04]`. The tests themselves key on behavior, not phase numbers, so no test logic changes — label only.

### 2. The `disconnect` wrapper must forward to `handleTransportDisconnect`, not `onDisconnect` alone (WARN — clarify before writing Task 4/5)
Task 4's prose says *"`onDisconnect` sets `disconnected` via `repo.update` and keeps the store entry; advancing fake timers past `graceMs` runs `abandonActivity`"*. But `onDisconnect` does **not** start a grace timer — only `handleTransportDisconnect` does (it calls `onDisconnect`, then `startGraceTimer(userId, () => abandonActivity(userId))`, activity-engine.service.ts:453–465). If the Task 1 `disconnect` wrapper calls `onDisconnect` directly, there is no timer to advance and the disconnect→grace→abandon and disconnect→reconnect-in-grace flows can't fire/cancel anything. Make the `disconnect` wrapper call `handleTransportDisconnect` (and `reconnect` → `handleReconnect`, which cancels the userId-keyed timer and resumes). This keeps both characterization flows GREEN today and keeps the single point Phase 55 will re-thread.

### 3. The Long-branch characterization test must compile (GREEN-now) — `clientTimestampMs` is typed `number`, so the `{ toNumber }` fixture needs an `as any` cast (minor — pin the cast)
`ActivityStartDto.clientTimestampMs` is `number` (activity-start.dto.ts:14) and `endActivity(userId, clientTimestampMs?: number)` is also `number`. Passing the Long-like `{ toNumber: () => ms }` object (the whole point of the Task 4 branch) is a **compile error** without a cast. The plan's compile-now note only authorizes `as any` for the *absent future* APIs; extend it: the Long fixture for the start- and end-path characterization tests passes `{ toNumber: () => ms } as any`. Runtime is fine — `coerceClientTs` detects `typeof === 'object' && typeof toNumber === 'function'` (activity-engine.service.ts:46–50).

### 4. Asserting `rootSessionId` on the persisted child row / state metadata (Task 6) needs an `as any` cast too (minor — consistent with the RED design, pin it)
Neither `ModuleSession` (entity has no such column — module-session.entity.ts) nor the `ActivityState` interface carries `rootSessionId` today. Task 6 asserts *"on the persisted child row and the stored `ActivityState` metadata"* — those property accesses won't type-check against the current types and must go through `(row as any).rootSessionId` / `(state as any).rootSessionId` to keep the file compiling (the assertion still fails at runtime → correct RED). Worth stating alongside the existing `(store as any)`/`(engine as any)` note so the implementer doesn't reach for a `!` or widen the entity type.

### 5. Target-API method names in Tasks 3/5 are provisional — fine for RED, but they define the spec-03 contract (minor — awareness)
Task 3 uses `addChild/getChild/listChildren`; Task 5 adds `setRoot`. These names don't exist yet, so the `(store as any)` access is RED regardless of exact naming. Just note that whatever names these target tests assert become the de-facto API the spec-03 implementer must match (or the tests get re-touched when turning green) — which is the intended TDD direction, not a defect.

## Positive Notes
- The revision is a faithful, surgical incorporation of review 1 — CI tolerance, the end-path Long guard, the `!`-free assertion rule, and the sole-child-resolution renaming all landed without over-editing the rest.
- The thin-wrapper-helper technique (assertions call `end(userId)`/`disconnect(userId)`; only helper bodies absorb the Phase 55 `sessionId` threading) remains the right way to keep a behavioral red distinguishable from a mechanical signature change.
- The compile-now-via-`(as any)` strategy correctly keeps the whole suite compiling while letting target tests fail at runtime rather than blocking compilation for every other spec.
- Task 7 (findings pass that records gaps into the spec's Findings section and flags the owning feature task, without editing the feature specs) is exactly the right escalation channel for the high-value silent cases (disconnect-moves-ALL, reconnect-resumes-ALL, revoke-stops-every-child+root).
- The author re-verified concrete source details rather than guessing — line references in the plan (`activity-engine.service.ts:128–132`) check out against the actual file.

## Verdict
Not a blocker-class plan, but finding 1 is a real, surviving internal contradiction (Task 6 label vs. the plan's own Context vs. the ROADMAP) that review 1 already raised — it should be corrected, and findings 2–4 should be pinned so the GREEN-now characterization tests actually compile and exercise the timer. Withholding the pass stamp for those fixes.
