# Plan Review 2 — Tests: per-service stream eviction, CONNECTION_SUPERSEDED + supersede-children

**Plan:** `42-tests-per-service-stream-eviction-connection-superseded-supersede-children.md`
**Governing specs:** `notes/46-test-per-service-stream-eviction.md` (authoritative test bodies) → `notes/47-per-service-stream-eviction.md` (feature under TDD)
**Files Reviewed:** plan + note 46 + note 47 + review-1 + all three target specs (`active-stream-registry.service.spec.ts`, `module-state.grpc.controller.spec.ts`, `activity-engine.service.spec.ts`) + `active-stream-registry.service.ts` + `ROADMAP.md`/`ROADMAP_TESTS.md`
**Risk Level:** 🟢 Low

## Context Gates
- **Architecture (`ARCHITECTURE.md`):** present. Test-only task confined to `src/realtime/`; no module-boundary or dependency impact. — OK
- **Rules (`RULES.md`):** present. Deliverable is `.spec.ts` edits only — no migration, no proto, no logging surface, no convention conflict. — OK
- **Roadmap (`ROADMAP.md`):** linked. Plan maps to `ROADMAP.md:156` (the TDD test task), which precedes its feature line `:157` (note 47) and docs line `:158` (note 48). Title matches verbatim; the RED-until-feature contract is faithfully carried. — OK
- **Governing-spec tree:** plan → note 46 → note 47 remain consistent on the pinned design (single slot per `(userId, service)`, `onEvict` pre-complete hook, `deregister → wasEvicted`, `supersedeChildren` two-loop sync-clear, `INTERRUPTED` + `endedAt`). — OK
- **Skill-context:** `.ai-factory/skill-context/aif-review/SKILL.md` — not present; no project overrides to apply.

## Review-1 Findings — all resolved
This plan is the revised artifact after `plan-review-1`. Each prior finding is now folded in:

1. **[Issue 1 — resolved] The two existing `register` 2-arg assertions are now swept.** Task 4 (plan `:49-52`) explicitly adds `module-state.grpc.controller.spec.ts:141-152` and `:736-752`, updating both to the 4-arg STATE shape `toHaveBeenCalledWith(user.sub, StreamService.STATE, expect.any(Subscriber), expect.any(Function))`, and correctly assigns the callback-behavior proof to B4 to avoid overlap. Verified both sites still hold the old 2-arg `toHaveBeenCalledWith(user.sub, expect.any(Subscriber))` at HEAD (`:147-150`, `:748`).
2. **[Issue 2 — resolved] `repo.save` is now stubbed in the race-safety target.** Task 6 (plan `:66`) mandates `repo.save.mockImplementation((s) => Promise.resolve(s))` with the exact rationale (post-resolve `saved.id` would throw against a correct impl otherwise). This matches the second Part C target's existing stub (note 46 `:173`).
3. **[WARN — resolved] Dead grep pointer replaced.** Task 6 (plan `:67`) now states there are no `stopActivity`/`INTERRUPTED` tests to copy and directs the implementer to the ABANDONED cases as the template. Verified: zero `INTERRUPTED` assertions in the engine spec; the ABANDONED shape lives at `:396-409` (and siblings).
4. **[WARN — resolved] Mock name + `push` shape corrected.** Task 6 (plan `:67`) names the emitter mock `emitter` (not `eventEmitter`) and gives the full `streamEngine.push(sessionId, { data: expect.objectContaining({ dataType: StreamDataType.SESSION_EVENT, event: StreamSessionEvent.INTERRUPTED }) })` shape. Verified against the ABANDONED assertion at `:396-405` and `emitter.emit(...)` at `:406-409`.
5. **[NOTE — resolved] `StreamService` import documented as part of the edit.** Notes-for-the-implementer (plan `:16`) states each spec adds the import and that the unresolved import is a legitimate compile-level RED. Import paths verified: registry spec and engine spec live under `services/` → `../constants/stream-service`; the controller spec lives at the realtime root → `./constants/stream-service`. `constants/` exists (holds `stream-data-types.ts` etc.); `stream-service.ts` does not yet — correct, note 47 introduces it.

## Verified Correct (grounded against HEAD)
- Controller spec factories `makeActivityEngine()` (`:28`) and `makeActiveStreamRegistry()` (`:60`) exist; `deregister: jest.fn()` (`:63`) and `handleTransportDisconnect` (`:38`) present — the B1 insertion points for the `deregister → false` default and `supersedeChildren` mock are accurate.
- The three `deregister` teardown assertions resolve by description exactly as the plan expects: unsubscribe (`:776`), observable-completes (`:875`), observable-errors (`:888`) — all currently 2-arg. Line drift vs. the note's `:669/:762/:774` anchors is real, and the plan's "locate by `it(...)` description" instruction (`:17`) covers it.
- Genuine-drop characterization `handleTransportDisconnect on teardown` at `:788` is untouched by the feature under the `false` default → the B2 `supersedeChildren.not.toHaveBeenCalled()` addition is sound.
- Engine spec uses a real `ActivitySessionStore` with mocked `repo`/`emitter`/`streamEngine`; `makeSession(overrides)` (`:39`) supports the `{ id: 'child-1' }` override the Part C targets rely on.
- The A3 distinct-service trap remains correctly enumerated against the same-userId multi-register cases (`:32-38`, `:114-138`, `:178-196`, `:212-229`).
- `session_error{CONNECTION_SUPERSEDED}`-then-`complete()` ordering (A1c), the B4 `onEvict` wiring proof, and the B3 takeover branch are all consistent with note 47's `register`/teardown implementation.

## Minor Issues / Warnings
- **WARN — imprecise "stay GREEN" label on the two swept register assertions (plan `:52`).** The two updated cases (`:141`, `:736`) are described as characterizations that "must stay GREEN through the feature." After the 4-arg update they are in fact **RED until note 47 lands** — today's controller still calls `register` with 2 args, so a 4-arg `toHaveBeenCalledWith` fails until the feature makes it 4-arg. This is fully consistent with the task's overarching "RED is expected" contract and is harmless in practice, but the wording could momentarily read as "a RED here is a mistake." Suggest rephrasing to "these become RED-until-feature targets (not RED-forever) and turn GREEN once note 47 lands" for clarity. Non-blocking.

## Positive Notes
- Every review-1 defect is addressed precisely and at the right task, not merely acknowledged — the two register sites are named with line anchors, and the `repo.save` stub carries the full failure-mode rationale inline rather than delegating to the (silent-on-it) note snippet.
- The A3 distinct-service trap — the highest-risk mechanical work — is handled case-by-case with explicit `STATE`/`INSTRUCTION`/`BIO`/`SYNC` assignments and the "passes for the wrong reason" reasoning.
- Task dependency chain and the 3-commit split align cleanly with the phase boundaries.
- `endedAt`-not-`disconnectedAt` and the `INTERRUPTED` status reuse are pinned with a rationale consistent across plan, note 46, and note 47 §6.

## Verdict
All two critical issues and three warnings from `plan-review-1` are resolved and verified against HEAD. The only remaining item is a cosmetic wording imprecision (the "stay GREEN" label) that does not change the implementer's actions. The plan is ready to hand off.

PLAN_REVIEW_PASS
