# Plan Review: Tests — bio ingest ownership, not echo-match

**Plan:** `20-tests-bio-ingest-ownership-not-echo-match.md`
**Target file:** `src/realtime/module-biometric-stream.grpc.controller.spec.ts` (test-only, no production change)
**Risk Level:** 🟢 Low

## Verdict

The plan is accurate, self-consistent, and grounded in the actual codebase. Every line
reference, behavioral claim, and RED/GREEN prediction was verified against the controller,
the spec, and the feature note. It is safe to implement.

## Verification performed

**Line references — all correct:**
- Anti-target case to invert is at spec `:276-292` ✓
- Controller step 6 (`SESSION_MISMATCH`) is at controller `:124-131` ✓
- Controller acks `droppedCount: result.totalDropped` at controller `:146` ✓
- GREEN-after cases to keep: root-id echo push `:255-274`, `NO_ROOT_SESSION` `:294-309`,
  paused-root `:311-329`, batch-hygiene smoke `:183-248` — all match exactly ✓

**`SESSION_MISMATCH` is the sole occurrence:** `grep` confirms it appears only inside the
single case at `:276-292` (test name `:276`, comment `:288`, assertion `:290`). Task 1's
pre-edit grep guard is satisfiable as written ✓

**RED→GREEN claim is sound:** Feature note `35-generalize-bio-ingest-ownership.md` explicitly
locks the decision to **delete controller step 6** (`:124-131`) and always push under `root.id`,
ignoring the client echo (note 35 §"The change", and §"Anti-targets" line 59 mandates inverting
exactly this committed test). Therefore:
- Task 1 (child-id echo, root-1): today step 6 fires `SESSION_MISMATCH` → inverted assertions
  fail cleanly via the captured error frame (RED, no hang). After note 35 → ack `root-1`, push
  `root-1` (GREEN). ✓
- Task 2 (`makeBatch('whatever')`, root-1): `'whatever'` passes steps 1–4, mismatches at step 6
  today → `SESSION_MISMATCH` → RED. After note 35 → GREEN. ✓
- Task 3 (characterization, `makeBatch('root-1')`): matches root today, passes step 6, reaches
  `pushBatch`. With `pushBatch` overridden to `{ ...totalDropped: 1 }`, the ack carries
  `droppedCount: result.totalDropped === 1`. GREEN now and after note 35 (step 6 removal does not
  affect a matching echo). ✓

**Helpers/fixtures reused are real:** `makeUser`, `makeStreamEngine`, `makeActivityEngine`,
`makeRoot`, `makeActiveStreamRegistry`, `makeBatch`, `firstNonReadyFrame` all exist in the spec
with the signatures the plan relies on. The per-test `beforeEach` rebuild means the Task 3
`mockReturnValue` override is correctly scoped and won't leak ✓

**No-hang guarantee holds:** `firstNonReadyFrame` resolves on the first frame with
`ready === undefined`, which captures both ack and error frames synchronously after the awaited
`ensureRoot` microtask — the RED cases return an error frame, not a hang ✓

**No migration / proto / security surface:** Test-only edit. Note 35 confirms "No proto change.
No migration." Nothing to flag here ✓

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md` present):** No boundary impact — the change is
  confined to one spec file and respects the realtime module's existing test structure. PASS.
- **Rules (`.ai-factory/RULES.md` present):** WARN (non-blocking). RULES.md states "NEVER use the
  non-null assertion operator (`!`)". The plan's assertions (`frame.ack!.sessionId`,
  `frame.ack!.droppedCount`) use `!`. However, that rule targets production code (force-unwrapping
  pushing `undefined` downstream); the existing spec already uses `!` pervasively
  (`frame.error!.code`, `values[0].ready!`, etc.). Following the established test convention is the
  consistent choice — flagging only for awareness, not as a blocker.
- **Roadmap:** This is a `tests`-scoped task, not `feat`/`fix`/`perf`, so direct ROADMAP linkage is
  not required. It traces cleanly to feature note 35 and the test-roadmap line (note 35 §Anti-targets
  references the test note that inverts this exact case). PASS.

## Minor Notes (non-blocking)

1. **Label wording inconsistency.** The plan introduces `[RED until note 35]`, while sibling cases
   in the same `describe` block use `[RED until spec 10-bio-ingest-to-root]` (word "spec" + slug).
   Both forms reference real note files (`10-bio-ingest-to-root.md`, `35-generalize-bio-ingest-ownership.md`),
   so the reference resolves correctly — but for grep-ability and visual consistency, consider
   matching the existing format, e.g. `[RED until note 35-generalize-bio-ingest-ownership]`.
   The `[characterization — must stay GREEN]` label in Task 3 already matches the existing
   convention exactly. Cosmetic only.

2. **Pre-existing mislabel (informational, out of scope).** The kept case at `:255-274` carries
   `[RED until spec 10-bio-ingest-to-root]` but is in fact GREEN today (a correct `root-1` echo
   already matches step 6). The plan correctly classifies it as a GREEN-after-note-35 case to leave
   intact; the stale label is pre-existing and outside this task's scope.

## Positive Notes

- The RED/GREEN/characterization split is precise: Tasks 1–2 are pure RED targets, Task 3 is a
  genuine invariant that survives the feature change — exactly the right TDD shape for a guard
  committed ahead of the implementation.
- The plan correctly forbids touching the controller and over-testing the loud `INVALID_ARGUMENT`
  paths, matching the spec's existing "assert each rejection code once" discipline.
- Dependency ordering (Task 2 → Task 1, Task 3 → Task 2) and the explicit pre-edit grep guard make
  the task safe to execute mechanically.

PLAN_REVIEW_PASS
