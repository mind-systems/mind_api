# Plan Review — Tests: multi-session lifecycle state machine (review 1)

**Plan:** `.ai-factory/plans/02-tests-multi-session-lifecycle-state-machine.md`
**Spec:** `.ai-factory/notes/16-test-session-lifecycle-state-machine.md`
**Risk Level:** 🟢 Low — the plan is accurate about the codebase; findings are documentation/labeling and implementer gotchas, none blocking.

## Verification performed
Cross-checked every concrete claim in the plan against the actual source:

- **Instantiation references (§17–19)** — match reality. `new ActivitySessionStore({ get: jest.fn()... } as any)` and the `ActivityEngine(repo, store, emitter, streamEngine)` 4-arg constructor, plus `makeRepo/makeEmitter/makeStreamEngine/makeSession` fixtures, are exactly what `activity-engine.service.spec.ts` and `activity-session-store.service.spec.ts` already use. ✓
- **Enums/events/constants (§21)** — all verified: `SessionStatus` values, `SessionEvents.{COMPLETED,ABANDONED,INTERRUPTED}`, `StreamDataType.SESSION_EVENT`, `StreamSessionEvent.{STARTED,ENDED,ABANDONED,INTERRUPTED,PAUSED,RESUMED}`, `ActivityType` (`breath/meditation`). ✓
- **`'root'` is not in `ActivityType`** — correct, and the plan's instruction to assert the literal string `'root'` for target tests is the right call. ✓
- **Engine method names** — `onDisconnect`, `abandonActivity`, `handleTransportDisconnect`, `handleReconnect`, `resumeActivity`, `abandonStale`, `getActiveSession`, `pauseActivity/unpauseActivity` all exist with the signatures the plan assumes. ✓
- **Characterization claims are genuinely GREEN-today**: the abandon guard (`status !== DISCONNECTED → no save/emit, clears store`), `hasPendingGraceTimer` teardown after fire/cancel, start→end→COMPLETED+ENDED, start→stop→INTERRUPTED, disconnect→grace→abandon, reconnect-in-grace→resume — all map to current code. ✓
- **Target APIs genuinely absent** — `ensureRoot`, `rootSessionId`, `store.addChild/getChild/listChildren` do not exist anywhere in `src/`, so the `(x as any)` access fails at runtime → red-for-the-right-reason. ✓
- **`handleSessionRevoked`** (referenced in Task 7) exists in `module-state.grpc.controller.ts:199`; `abandonStale` is wired from `session-watchdog.service.ts:82`. ✓
- **Jest config** — `testRegex: ".*\\.spec\\.ts$"`, `rootDir: src`. The new file path `src/realtime/services/multi-session-lifecycle.spec.ts` will be picked up. ✓

## Context Gates
- **ARCHITECTURE.md** — present; no boundary/dependency conflict. The plan stays inside the `realtime` module's own service specs. WARN: none.
- **RULES.md** — present. See finding 4 (non-null assertion `!`). WARN (non-blocking).
- **ROADMAP.md** — present and the task is on it (line 19). See finding 1 — the plan's phase attribution for lazy-root contradicts the ROADMAP. WARN.
- **skill-context/aif-review/SKILL.md** — not present; no project-specific review overrides to apply.

## Critical Issues
None. No missing migration is required — the deliverable is test files only, and the entity/column work (`rootSessionId`) is explicitly owned by the downstream feature tasks, not this plan.

## Findings (WARN / minor)

### 1. Phase-number mismatch for lazy-root / `ensureRoot` (WARN — fix the labels)
The plan labels Task 6 `[RED until Phase 56]` and the Context says target tests are "expected RED until Phase 55/56". But `ROADMAP.md` places **both** feature specs under **Phase 55 — Multi-session core**:
- `03-multi-session-store-engine` (store/engine refactor) → Phase 55
- `04-lazy-root-creation` (ensureRoot + child linking) → Phase 55

`## Phase 56` is **"Proto + concurrent activities"** — unrelated to root creation. So `ensureRoot`/linking target tests turn GREEN when the **Phase 55** lazy-root task lands, not Phase 56. The tests themselves are unaffected (they key on behavior, not phase numbers), but the labels will mislead a reviewer about which feature task closes the red. Recommend: change Task 6's describe label and the Context wording from "Phase 56" → "Phase 55 (lazy-root-creation / spec 04)". The spec note (16) correctly refers to it by spec name `04-lazy-root-creation` — align the plan to that.

### 2. Committed RED tests will fail `npm test` / CI until Phase 55 lands (WARN — confirm tolerance)
`testRegex` matches all `*.spec.ts`, so the intentionally-RED target blocks (Tasks 3, 5, 6) make the whole `npm test` suite red until the feature lands. The plan explicitly acknowledges this as the intended TDD signal and forbids `.skip`/`.todo` — that's a legitimate red-first choice, not a defect. Flagging only so the implementer/reviewer confirms it's acceptable for this repo's gates: any pre-commit hook or CI step that runs `npm test` as a pass/fail gate will block on these. If the pipeline can't tolerate a red suite between commits, land the test commit on the same branch as Phase 55 or gate CI on a path filter. No change to the test design is requested.

### 3. `endActivity` honors `clientTimestampMs` only when `>= startedAt` (minor — pin fixtures)
`endActivity` (activity-engine.service.ts:128–132) uses the client timestamp only if `clientEnd.getTime() >= session.startedAt.getTime()`, else falls back to server `now()`. Task 4's `coerceClientTs` Long-branch test for the **end** path must choose a Long `ms ≥ session.startedAt`, otherwise it silently takes the server-now fallback and the "honored exactly as the numeric path" assertion passes for the wrong reason (and proves nothing about the Long branch). The same guard governs the numeric path, so the two paths stay consistent — this is purely a fixture-value gotcha to call out for the implementer. (For `startActivity` there is no such guard — the Long branch there is clean.)

### 4. RULES.md forbids the non-null assertion `!` (WARN — established test convention)
`RULES.md` bans `!` (e.g. `state!.sessionId`). The existing specs already use it heavily (`activity-engine.service.spec.ts:89`), so the new spec following that pattern would technically violate the rule. Since it's pre-existing test convention and the rule's rationale (silent undefined downstream) is weaker in assertion code, this is non-blocking — but prefer `expect(state).toBeDefined()` then access, or local guards, to stay rule-clean. The plan's `(store as any)` / `(engine as any)` compile-now casts are **not** covered by this rule and are fine.

### 5. Task 3 bullet 3 sits under a `target [RED]` block but reads like characterization (minor — clarify intent)
"Preserve single-child get/set/delete semantics for the legacy convenience accessors" is placed under `describe('target — multi-session store [RED until Phase 55]')`. Today's `get/set/delete` are GREEN, so as literally worded this could be mistaken for a characterization assertion mis-filed in a RED block. The defensible reading is that it tests the **new** sole-child *resolution* accessor (the future convenience method that resolves the single child out of the children map) — which is RED today. Make the test name say that explicitly (e.g. "sole-child resolution accessor returns the single child") so the red/green classification is unambiguous and a reviewer doesn't "fix" it.

### 6. File naming deviates from `*.service.spec.ts` (minor — acceptable)
Existing specs are `<service>.service.spec.ts`; the new file is `multi-session-lifecycle.spec.ts`. It matches `testRegex` and the file legitimately spans two services, so this is fine — noted only for convention awareness.

## Positive Notes
- The red/green discipline section is unusually rigorous and correct: characterization-must-stay-green, target-stays-red-for-the-right-reason, no `.skip`/patching, escalate-don't-patch on a post-refactor regression. This is the right TDD contract for a behavior-preserving refactor.
- The **thin-wrapper-helper** technique (assertions call `end(userId)`/`disconnect(userId)`, only helper bodies absorb the Phase 55 `sessionId` threading) is a sound way to keep a behavioral red distinguishable from a mechanical signature change.
- The **compile-now via `(x as any)`** strategy correctly keeps the whole suite compiling while letting target tests fail at runtime instead of blocking compilation for everyone.
- Every codebase-specific detail the plan asserts (constructor shapes, enum/event names, the abandon guard, `hasPendingGraceTimer` teardown, the `coerceClientTs` Long branch, server-clocked `lastActivityAt`) was verified accurate — the plan author clearly read the actual source, not a guess.
- Task 7 (adversarial findings pass into the spec's Findings section, flagging gaps to the owning feature task without editing feature specs) is exactly the right place to surface the high-value silent cases (disconnect-moves-ALL, reconnect-resumes-ALL, revoke-stops-every-child+root).
