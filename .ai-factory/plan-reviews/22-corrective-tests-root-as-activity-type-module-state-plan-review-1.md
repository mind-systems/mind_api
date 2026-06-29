# Plan Review: Corrective tests — root-as-activity-type (module-state)

**Plan:** `.ai-factory/plans/22-corrective-tests-root-as-activity-type-module-state.md`
**Target file:** `src/realtime/module-state.grpc.controller.spec.ts` (test-only)
**Reviewed against:** committed spec (`5221b38`), controller source, generated stub, notes 34/37, ROADMAP.

## Summary

**Risk Level:** 🟡 Medium

The plan is structurally sound: it correctly identifies the single touched file, matches every revert against the actual committed content (line refs verified — `(a)` :152-180, fresh-connect :202-223, `(b)` :284-312, `(c)` :315-336, deletes :340-361/:363-401/:403-432, `(d)` :436-474 all line up), and the RED/GREEN reasoning for the new targets is correct (ROOT throws in `mapProtoActivityType` today → no frame / `INVALID_ACTIVITY_TYPE`; root-end has no guard today). The compile-now strategy (numeric cast for the input enum) is valid since `ActivityType.ROOT` and `StateEvent.activity_type` do not exist in the current generated stub (confirmed).

However there is **one blocking defect** that would make the primary target test impossible to ever turn GREEN, plus two smaller correctness issues. These should be fixed before implementation.

### Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md` present): No boundary issues. Test-only change inside the realtime module; no cross-module coupling introduced. **PASS**
- **Rules** (`.ai-factory/RULES.md` present): No rule violations — no production/proto/migration changes, no logging added (correctly marked "Logging: no"). **PASS**
- **Roadmap** (`.ai-factory/ROADMAP.md` present): Task is explicitly tracked at line 73 ("Corrective tests: root-as-activity-type (module-state)") with matching Spec note 37. Linkage present. **PASS**
- **skill-context** (`.ai-factory/skill-context/aif-review/SKILL.md`): MISSING — no project-specific review overrides to apply. **WARN (optional file absent)**

---

## Critical Issues

### 1. Discriminator field name is wrong — target can never go GREEN (ERROR)

Tasks 4 instruct the discriminator assertion as:

> `(frame.sessionState as any).activity_type === 3` (ROOT)

`ts-proto` camelCases every snake_case proto field. The current generated stub proves this: proto `module_session_id` → `moduleSessionId`, `is_paused` → `isPaused` (`proto/generated/module_state.ts:99-101`). Note 34 adds the discriminator as `ActivityType activity_type = 4` to `StateEvent`, which `ts-proto` will generate as **`activityType`**, not `activity_type`. a1's controller emits a TS object typed as `StateEvent`, so the emitted key will be **`activityType`**.

Consequence: the **ROOT-start positive target** (`assert (frame.sessionState as any).activity_type === 3`) reads a key that will never exist. The frame carries `activityType: 3`, but the test reads `.activity_type` → `undefined !== 3`. The target stays **RED forever**, even after a1 lands — falsely signalling a1 as incomplete. This defeats the entire purpose of a RED→GREEN corrective target.

The same defect propagates from note 34 (line 34) and note 37 (lines 23/34/37), so it is not original to this plan — but the plan is the deliverable and must correct it.

**Fix:** read the discriminator as the camelCased field: `(frame.sessionState as any).activityType === 3`. Keep the `as any` cast (the field is still absent from the stub until a1 regenerates, so the cast is still required for compile-now). Apply the same correction to the **child-start** case (`.activityType !== 3`) and to note 37's wording if it is later reused.

### 2. `makeSession({ activityType: 'breath' })` will not compile (ERROR for compile-now)

Task 4 child-start case: `startActivity.mockResolvedValue(makeSession({ id: 'child-1', activityType: 'breath' }))`.

The helper is typed `function makeSession(overrides?: Partial<{ id: string }>)` (spec :24). Passing an object literal with `activityType` triggers TypeScript's excess-property check → compile error. This violates the plan's own compile-now rule (the deliverable must compile today).

Note also that `activityType` on the session object is **never read** by the controller for the emitted discriminator — a1 derives the emitted `activityType` from `mapProtoActivityType(cmd.activityType)` (the input command), not from the session entity (per note 34 Part 2). So the property is decorative.

**Fix:** either (a) drop `activityType` from the `makeSession` call (it has no effect on the assertion), or (b) widen the helper signature to `Partial<{ id: string; activityType: string }>`. Option (a) is simpler and matches reality.

---

## Medium / Should-Fix

### 3. Idempotency target risks a false-GREEN if asserted as self-equality (WARN)

Task 4 idempotent case: "two `activity:start ROOT` commands … both emitted frames carry the same `moduleSessionId`".

If the implementer writes this as `expect(values[0].sessionState?.moduleSessionId).toBe(values[1].sessionState?.moduleSessionId)`, it will **pass today** (RED phase) because today both commands hit `INVALID_ACTIVITY_TYPE` and emit `sessionError` frames — both `moduleSessionId` are `undefined`, and `undefined === undefined`. A target that is green today provides no RED signal.

**Fix:** assert against the literal identity, e.g. `expect(values[0].sessionState?.moduleSessionId).toBe('root-1')` and the same for `values[1]` (and assert both are `sessionState`, not `sessionError`). This is RED today (no `sessionState` emitted) and GREEN after a1.

The same weakness applies more mildly to the **child-start** case: `.activityType !== 3` is `true` whenever the field is absent (today and forever if Issue 1 is unfixed), so it never discriminates. After fixing Issue 1 it still passes today (field absent). Consider asserting the child frame's `activityType` is *defined and equals the child type* once a1 lands — though as a "child is not root" guard the `!==` form is acceptable if the intent is only negative.

---

## Cross-Task Observation (advisory — not a defect in this plan)

Adding `getRootId: jest.fn()` (default return `undefined`) is correct and does not affect any GREEN test today (the controller never calls `getRootId` pre-a1). However, note for the a1 review: a1's proposed guard `if (resolved.sessionId === this.activityEngine.getRootId(userId))` will, for a no-explicit-sessionId `activity:end`/`activity:stop` where `resolveTargetSession` returns `sessionId: undefined`, compare `undefined === undefined` → `true` and wrongly reject with `CANNOT_END_ROOT`. That would break the existing characterization tests (e.g. "should call `endActivity(userId)` when ActivityEnd is received", spec :874). a1 must guard `resolved.sessionId !== undefined && resolved.sessionId === getRootId(userId)`. This is a1's concern, not this test plan's, but the test suite this plan produces is exactly what will catch it — worth flagging so a1 isn't surprised.

---

## Positive Notes

- Single-file scoping, no production/proto/migration changes — correct and clearly stated.
- Every revert is anchored by content with verified line ranges; the "apply by content, not absolute line" guard is the right call given Phase 1 shifts line numbers.
- The `setupRoutingStream` drain handling (keep `values.length = 0`, refresh the stale "feature 34" comment) is correct — post-revert there is no connect frame, so the drain is a harmless no-op and index assertions stay stable.
- The reject-root-end/stop targets correctly mock `getRootId` (not `getSession`), matching a1's actual delegate per note 34 — the plan even explains why mocking `getSession` would leave the target falsely RED. Good defensive reasoning.
- GREEN characterization cases (auth, teardown, setup-error, `handleSessionRevoked`, resumed-id, subscribe-ordering, subscriber-closed) are correctly left untouched.

---

## Verdict

Do not pass as-is. Issues 1 and 2 are blocking: Issue 1 makes the headline target untestable (permanent false-RED), and Issue 2 breaks the compile-now requirement. Issue 3 prevents a false-GREEN. All three are small, localized edits to the new Phase 2 cases. Fix them and the plan is solid.
