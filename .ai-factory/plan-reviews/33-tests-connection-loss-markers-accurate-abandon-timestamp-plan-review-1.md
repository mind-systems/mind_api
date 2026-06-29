# Plan Review — Tests: connection-loss markers + accurate abandon timestamp

**Plan:** `33-tests-connection-loss-markers-accurate-abandon-timestamp.md`
**Risk Level:** 🟢 Low
**Verdict:** Solid — every pinned line number, API signature, and behavioral claim was verified against live source.

## Scope
Test-only milestone. Adds committed-RED TDD tests to `activity-engine.service.spec.ts` guarding two silent gaps (no timeline marker on connection loss; grace-abandon inflates `endedAt`). No production source edited. Spec drivers: `.ai-factory/notes/27-test-connection-loss-markers.md` (test plan) and `.ai-factory/notes/23-connection-loss-markers.md` (the future feature).

## Context Gates
- **Architecture** (`.ai-factory/ARCHITECTURE.md` present): No boundary/dependency concerns. The plan touches only a spec file inside the `realtime` module and instantiates the real `ActivitySessionStore` plus mocks for `repo`/`emitter`/`streamEngine` — consistent with the existing spec's construction. PASS.
- **Rules** (`.ai-factory/RULES.md` present): No rule references tests/mocks/timers that would constrain this plan. PASS.
- **Roadmap** (`.ai-factory/ROADMAP.md` present): Explicit linkage found — line 113 "Tests: connection-loss markers + accurate abandon timestamp" matches this milestone verbatim, citing spec note 27; the downstream feature is Phase 61 / note 23. PASS.
- **skill-context** (`.ai-factory/skill-context/aif-review/SKILL.md`): MISSING — no project-specific review overrides to apply. WARN (non-blocking, optional file).

## Verification of plan claims against source

All line pins resolve correctly in the current file:

| Plan claim | Source | Status |
|---|---|---|
| `handleTransportDisconnect ~:672`, iterates `[rootId, ...childIds]`, per-session `onDisconnect` + grace timer, **no** marker push | `activity-engine.service.ts:672-692` | ✓ Confirmed — pushes nothing, so disconnect-marker count is 0 today → genuine RED |
| `onDisconnect ~:299` does `repo.update(sid, {status: DISCONNECTED, disconnectedAt})`, no push | `:299-314` (`repo.update` at `:308`) | ✓ |
| `abandonActivity ~:316`, `endedAt = now` at `:339`, guarded by `status !== DISCONNECTED` | `:316-363` | ✓ — guard at `:333` means the Task-4 fixture must be `DISCONNECTED` (plan does this) |
| `abandonStale` is a **separate** method `~:365`, `endedAt = now` at `:388`, never reads `disconnectedAt` | `:365-414` | ✓ — characterization fixture (ACTIVE, never-disconnected) flows past the final-status guard at `:379` |
| `handleReconnect ~:629` cancels grace + `resumeActivity` per session, no push | `:629-670`; `resumeActivity:596-627` has no push | ✓ → reconnect-marker count is 0 today → RED |
| Store API: `setRoot`/`addChild`/`getRootId`/`listChildren`/`getSession`, grace helpers `startGraceTimerForSession`/`cancelGraceTimerForSession`/`hasPendingGraceTimerForSession` | `activity-session-store.service.ts:65,92,79,116,108,140,152,159` | ✓ all exist with the asserted signatures |
| `StreamSessionEvent` has no `DISCONNECTED`/`RECONNECTED`; only STARTED/ENDED/ABANDONED/INTERRUPTED/PAUSED/RESUMED | `stream-data-types.ts:6-13` | ✓ — literal-string approach is mandatory to compile |
| Literal future values are `'disconnected'` / `'reconnected'` | `notes/23-connection-loss-markers.md:22` (`DISCONNECTED: 'disconnected'`, `RECONNECTED: 'reconnected'`) | ✓ — the literal strings the plan asserts exactly match the values note 23 will introduce, so the RED→GREEN transition is real, not a permanent red |
| 4-arg ctor `(repo, store, emitter, streamEngine)` | `:29-35` | ✓ matches existing `beforeEach` wiring |
| Default grace 30s when ConfigService returns undefined | store `:5,20-23` | ✓ |

### Subtle correctness points the plan handles correctly
- **`setRoot` must receive a `state` argument.** `handleTransportDisconnect` → `onDisconnect` early-returns unless `getSession(userId, rootId)` resolves, and root resolution requires `getRoot()` to return a state (store `:108-113`). The plan explicitly seeds via `setRoot(userId, rootId, state)` with the optional state, so `repo.update` *will* fire for the root and grace timers arm for root + each child (the loop at `:681-691` arms a timer per sid unconditionally). The Task-2 characterization assertion (`hasPendingGraceTimerForSession` true for root + every child) therefore holds.
- **Task 4 needs `status: DISCONNECTED`.** The `:333` guard skips save for any non-DISCONNECTED status. The plan's fixture uses DISCONNECTED — correct.
- **Grace-timer hygiene.** `handleTransportDisconnect` arms *real* `setTimeout` handles; the plan's mandate to cancel them per seeded session (or fake-timers + afterEach) is necessary to avoid leaked handles, and "never advance timers" correctly prevents `abandonActivity` from firing mid-test.

## Findings

No critical issues. No blocking issues.

### Minor / advisory (non-blocking)
1. **WARN — committed-RED tests turn the package suite red until note 23 lands.** This is the explicit, intended deliverable (silent-bug-first TDD; notes 27 and the roadmap both call for committed RED), so it is not a plan defect. Flagging only so downstream operators are not surprised that `npm test` in `mind_api` fails on the Phase-2 cases until spec 23 is implemented. If CI gating on this package would block unrelated work, consider sequencing note 23 promptly after this milestone.
2. **Advisory — Task 3 assertion ordering.** When filtering `streamEngine.push.mock.calls` for `data.event === 'disconnected'`, the count is 0 today; the test must assert the count (`=== 1`) *before* indexing into the matched call to read its `sessionId` arg, or the RED run throws a TypeError instead of a clean assertion failure. Pure implementer hygiene — already implied by "assert count == 1 AND the id", just worth making explicit.
3. **Advisory — Task 1 hygiene note covers Task 3.** The "cancel grace timers after each `handleTransportDisconnect`" instruction lives in Task 1 and is global; ensure the Task-3 spam-guard case (root + 2 children → 3 armed timers) also cancels all three. The plan's wording ("for the root and every seeded child") covers this; no change needed.

## Positive Notes
- Exceptionally well-pinned: every `~:NNN` location in the plan resolves to the correct method in the current file, and the plan explicitly warns that the *spec note's* older line numbers are stale and re-pins them — exactly right.
- The literal-string vs enum-member distinction (L2) is correctly motivated and the chosen strings match note 23's future values, guaranteeing the RED cases become GREEN rather than staying red forever.
- Characterization vs target split is clean, with an explicit escalation valve (a red characterization after note 23 = regression, don't patch) that matches note 27's L4.
- The spam-guard (one root-keyed `'disconnected'` push, never per-child) is correctly identified as load-bearing and tied back to the actual `[rootId, ...childIds]` iteration that creates the spam risk.
- Outcome-only assertion discipline (mock-visible `streamEngine.push` args + `repo.save` argument; no private-buffer inspection) is respected throughout.

PLAN_REVIEW_PASS
