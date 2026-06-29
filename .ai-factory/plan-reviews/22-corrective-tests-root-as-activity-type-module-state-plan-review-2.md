# Plan Review 2: Corrective tests — root-as-activity-type (module-state)

**Plan:** `.ai-factory/plans/22-corrective-tests-root-as-activity-type-module-state.md`
**Target file:** `src/realtime/module-state.grpc.controller.spec.ts` (test-only)
**Reviewed against:** committed spec (`5221b38`), controller source (`module-state.grpc.controller.ts`), generated stub (`proto/generated/module_state.ts`), notes 34/37, ROADMAP, RULES.

## Code Review Summary

**Files Reviewed:** 1 plan + cross-checked against 4 source/context files
**Risk Level:** 🟢 Low

This is the second review. All three issues raised in review-1 (discriminator field name, `makeSession` excess-property, idempotency self-equality) have been correctly folded into the plan body. Re-verification against the real code confirms every assumption holds.

### Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md` present): No boundary issues. Test-only change confined to the realtime module; no cross-module coupling introduced. **PASS**
- **Rules** (`.ai-factory/RULES.md` present): No rule touched — no production/proto/migration change, no logging, no `!` operator, no `@Payload`/`@GrpcCurrentUser` change. Correctly marked "Logging: no". **PASS**
- **Roadmap** (`.ai-factory/ROADMAP.md` present): Task tracked at line 73 ("Corrective tests: root-as-activity-type (module-state)") with matching Spec note 37 and guarded feature a1 (note 34, line 84). Linkage present. **PASS**
- **skill-context** (`.ai-factory/skill-context/aif-review/SKILL.md`): MISSING — no project-specific review overrides to apply. **WARN (optional file absent)**

---

## Verification of review-1 fixes

1. **Discriminator field name (was the blocking ERROR).** Plan now reads the field via its camelCased name: line 18 explains the `ts-proto` camelCasing rule explicitly (`module_session_id → moduleSessionId`, `is_paused → isPaused`), and Tasks 4 assert `(frame.sessionState as any).activityType === 3` / `!== 3`. Confirmed against the stub: `StateEvent` is generated as `{ moduleSessionId, status, isPaused? }` (`proto/generated/module_state.ts:98-101`), so a1's `activity_type = 4` will generate as `activityType`. **Fixed correctly.**

2. **`makeSession` excess-property (was the compile-now ERROR).** Task 4 child-start case (plan line 55) now explicitly says *do not* pass `activityType` to `makeSession` and explains both the excess-property check (helper is `Partial<{ id: string }>`, confirmed at spec :24) and the fact that a1 derives the emitted discriminator from `mapProtoActivityType(cmd.activityType)`, not the session entity. **Fixed correctly.**

3. **Idempotency self-equality false-GREEN (was the WARN).** Task 4 idempotent case (plan line 54) now asserts the literal `'root-1'` and that both frames are `sessionState` (not `sessionError`), with an explicit note that self-equality would let `undefined === undefined` pass today. **Fixed correctly.**

## Independent re-verification (this review)

- **Compile-now premise holds.** The generated stub has `ActivityType = { UNSPECIFIED=0, BREATH=1, MEDITATION=2, UNRECOGNIZED=-1 }` (`:21-25`) — no `ROOT`, so `3 as ActivityType` is required today and `ROOT = 3` is the next free number a1 will add. `StateEvent` has no `activityType` field yet, so the `as any` cast is genuinely necessary. Confirmed.
- **RED reasoning holds.** Today `mapProtoActivityType` (controller :41-64) maps only BREATH/MEDITATION and throws on everything else → a ROOT start emits `INVALID_ACTIVITY_TYPE` (controller :360-369), so the ROOT-start positive target is RED. `handleActivityEnd`/`handleActivityStop` (controller :395-446) have no root guard → root-end emits COMPLETED (or no frame), never `CANNOT_END_ROOT`, so the reject targets are RED. Both flip GREEN under a1 (note 34 Part 2). Confirmed.
- **Reject-end vantage holds.** `resolveTargetSession` returns `{ ok: true, sessionId: 'root-1' }` for an explicit `sessionId` (controller :287-288); mocking `getRootId.mockReturnValue('root-1')` makes a1's `resolved.sessionId === getRootId(userId)` true. Today `endActivity` is invoked (default mock resolves `null` → no frame), so "endActivity not called" + "no CANNOT_END_ROOT" are both RED today. Confirmed.
- **Line references hold.** Spot-checked against the committed file: `(a)` :152-180, ensureRoot setup :156-158, drop :176-177; fresh-connect :202-223; `(b)` :284-312; `(c)` :315-336; deletes :340-361 / :363-401 / :403-432; `(d)` :436-474 (ensureRoot :438-440, values[1] :460); `setupRoutingStream` drain comment :757-760; `makeActivityEngine` :28-44; characterization `endActivity(userId)` at :874. All align. The "apply by content, not absolute line" guard (plan line 19) correctly anticipates Phase 1 shifting later line numbers.
- **`getRootId` mock addition holds.** `makeActivityEngine` (spec :28-44) has no `getRootId` today; adding only `getRootId: jest.fn()` matches a1's sole new delegate (note 34 :54-56). Default return `undefined` does not affect any GREEN test (the controller never calls `getRootId` pre-a1). Confirmed.
- **Advisory for a1 (plan line 20) is accurate.** The bare `resolved.sessionId === getRootId(userId)` would compare `undefined === undefined` for a no-sessionId `activity:end` and wrongly reject — breaking the GREEN characterization case at :874. Correctly flagged as a1's concern, not this plan's.

---

## Minor / Advisory (non-blocking)

### A. "Routes through `ensureRoot`, not `startActivity`" is GREEN today, not RED (advisory)

Task 4 case 2 asserts `ensureRoot` was called and `startActivity` was not, for a ROOT command. Note that `setup()` calls `await this.activityEngine.ensureRoot(userId)` unconditionally on every connect (controller :154), so `expect(ensureRoot).toHaveBeenCalled()` is already true from connect — it does not isolate the command's call. And today the ROOT command throws in `mapProtoActivityType` before reaching `startActivity`, so `startActivity` is also not called. Net: this case passes today and provides no RED signal — it functions as a *guard* that a1 must keep green (catching a naive a1 that routes ROOT through `startActivity`), not as a RED→GREEN target.

This is acceptable as written (the headline RED target is case 1, the `activityType === ROOT` frame). If a stronger signal is wanted, snapshot the call count after `flushMicrotasks()` (post-connect) and assert one *additional* `ensureRoot` call after the ROOT command — but this is optional polish, not a defect.

### B. New describe needs no connect-frame drain (confirmation, not a change)

Post-revert there is no connect-time emission on the default `handleReconnect → null` path, so the new `trackActivity — client-started root` cases can capture `values[]` directly without the `values.length = 0` drain used by `setupRoutingStream`. The plan's vantage description (line 51) is consistent with this. No action needed.

---

## Positive Notes

- All three review-1 blockers are resolved in-body with explanatory comments baked into the plan, so the implementing agent inherits the reasoning, not just the corrected code.
- Compile-now strategy is fully spelled out (`const ROOT_ACTIVITY_TYPE = 3 as ActivityType` with comment, `as any` discriminator read by camelCased name) and matches the actual generated stub.
- Single-file scoping with no production/proto/migration changes — correct and clearly stated.
- Reverts are anchored by content with verified line ranges; the "apply by content" guard is the right call for a Phase 1 that renumbers lines.
- Reject-end/stop targets correctly mock `getRootId` (a1's real delegate) rather than `getSession`, with an explicit rationale for why the wrong mock would leave the target falsely RED after a1.
- GREEN characterization cases (auth, teardown, setup-error, `handleSessionRevoked`, resumed-id, subscribe-ordering, subscriber-closed, command-routing) are correctly left untouched.

---

## Verdict

The two blocking issues and the false-GREEN risk from review-1 are all fixed and independently re-verified against the source. Remaining items are advisory polish, not defects. The plan is solid and ready to implement.

PLAN_REVIEW_PASS
