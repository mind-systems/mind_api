## Plan Review Summary

**Plan:** Fix `docs/realtime/telemetry-model.md`
**Files Affected:** 1 (documentation only)
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** `WARN` — no architectural concerns; docs-only change.
- **RULES.md:** `WARN` — no code rules apply to documentation edits.
- **ROADMAP.md:** OK — plan maps directly to the unchecked Phase 12 item "Fix `docs/realtime/telemetry-model.md`".

### Review of First-Round Fix

All four issues from plan-review-1 have been addressed:

1. ✅ Event placement fixed — `session_abandoned` and `session_interrupted` now placed **after** `session_ended` as terminal events.
2. ✅ Trigger sentence (line 56) now explicitly updated in Task 1 step 3.
3. ✅ Stale controller name on line 81 addressed in new Task 3 step 1.
4. ✅ Stale service name on line 99 addressed in new Task 3 step 2.

### Verification Against Source Code

All six `StreamSessionEvent` values confirmed in `src/realtime/constants/stream-data-types.ts`. All triggers verified:

| Event | Method | Trigger |
|-------|--------|---------|
| `session_started` | `startActivity()` | `ActivityStartCmd` |
| `paused` | `pauseActivity()` | `ActivityPauseCmd` |
| `resumed` | `unpauseActivity()` | `ActivityResumeCmd` |
| `session_ended` | `endActivity()` | `ActivityEndCmd` |
| `session_abandoned` | `abandonActivity()` | Grace timer expiry |
| `session_interrupted` | `stopActivity()` | `ActivityStopCmd` |

File paths and class names verified:
- `ModuleInstructionStreamGrpcController` → `src/realtime/module-instruction-stream.grpc.controller.ts` ✅
- `ModuleInstructionStreamService` → proto service in `proto/module_instruction_stream.proto` ✅
- `ModuleInstructionGrpcController` does not exist in code (stale name, correctly flagged) ✅
- `ModuleInstructionService` does not exist in code (stale name, correctly flagged) ✅

### Issues

**1. Task 1 step 2 — "or on server restart" is inaccurate for the instruction model**

The plan proposes adding a note that `session_abandoned` is written "when the grace period expires without reconnection (or on server restart)."

This is incorrect in the context of the instruction stream. `StartupRecoveryService.onApplicationBootstrap()` (lines 16–35) marks orphan sessions as `ABANDONED` in the database, but it does **not** call `ActivityEngine.abandonActivity()` and does **not** write a `session_abandoned` instruction sample via `StreamEngine.push()`. Only `ActivityEngine.abandonActivity()` (line 174) writes the instruction.

Since this document is specifically about the instruction model — what gets written to the instruction stream — stating that `session_abandoned` is "written on server restart" is factually wrong. The instruction stream for those sessions simply ends without a terminal marker.

Fix: remove the "(or on server restart)" parenthetical. The note should only mention grace period expiry:

> `session_abandoned` is written when the grace period expires without reconnection.

### Positive Notes

- All first-round issues resolved cleanly — the plan is in good shape.
- Event ordering (start → mid-session → terminal alternatives) is logically sound.
- The proposed trigger sentence rewrite is accurate: it correctly separates `activity:*` commands from the grace period trigger.
- Writing in Russian to match the existing document — correct per project convention.
- Task 3 (stale names) is a good addition that prevents the doc from needing yet another patch.

PLAN_REVIEW_PASS
