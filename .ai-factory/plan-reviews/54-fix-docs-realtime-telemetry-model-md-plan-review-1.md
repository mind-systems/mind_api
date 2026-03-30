## Plan Review Summary

**Plan:** Fix `docs/realtime/telemetry-model.md`
**Files Affected:** 1 (documentation only)
**Risk Level:** 🟢 Low

### Context Gates

- **ARCHITECTURE.md:** `WARN` — no architectural concerns; this is a docs-only change.
- **RULES.md:** `WARN` — no code rules apply to documentation edits.
- **ROADMAP.md:** OK — plan maps to Phase 12 item: "Fix `docs/realtime/telemetry-model.md`".

### Verification Against Source Code

Confirmed `StreamSessionEvent` in `src/realtime/constants/stream-data-types.ts` defines exactly six values:

| Constant | Value | Emitted by |
|----------|-------|------------|
| `STARTED` | `session_started` | `ActivityEngine.startActivity()` |
| `ENDED` | `session_ended` | `ActivityEngine.endActivity()` |
| `ABANDONED` | `session_abandoned` | `ActivityEngine.abandonActivity()` |
| `INTERRUPTED` | `session_interrupted` | `ActivityEngine.stopActivity()` |
| `PAUSED` | `paused` | `ActivityEngine.pauseActivity()` |
| `RESUMED` | `resumed` | `ActivityEngine.unpauseActivity()` |

The plan correctly identifies the two missing events and their triggers. No wrong assumptions about the codebase.

### Issues

**1. Task 1 — Event placement in the JSON block is wrong**

The plan says: *"add `session_abandoned` and `session_interrupted` to the JSON examples between `session_started` and `paused`"*.

`session_abandoned` and `session_interrupted` are **terminal events** — alternative ways a session ends, semantically parallel to `session_ended`. Placing them between `session_started` and `paused` (a mid-session event) breaks the logical flow.

Correct placement: after `session_ended`, so the block reads start → mid-session → terminal:

```json
{ "event": "session_started" }
{ "event": "paused" }
{ "event": "resumed" }
{ "event": "session_ended" }
{ "event": "session_abandoned" }
{ "event": "session_interrupted" }
```

**2. Task 1 — Trigger sentence on line 56 not updated**

Line 56 currently reads:

> Пишется `ActivityEngine` при обработке `activity:start/pause/resume/end`.

This lists only the four commands that trigger the existing four events. With six events, two new triggers are missing:

- `session_abandoned` — triggered by grace period timer, not a user command
- `session_interrupted` — triggered by `ActivityStopCmd` (`activity:stop`)

The plan adds explanatory notes for the new events but does not update the existing sentence that enumerates triggers. After the fix, line 56 would still claim events are only written for `activity:start/pause/resume/end` — which is incomplete and contradicts the new entries directly above it.

Fix: update line 56 to mention `activity:stop` and grace period expiry, or rewrite the sentence to be generic (e.g., "Пишется `ActivityEngine` при каждом lifecycle-переходе сессии").

**3. Stale controller name on line 81 — not addressed**

Line 81 references `ModuleInstructionGrpcController`, but the actual controller class is `ModuleInstructionStreamGrpcController` (file: `src/realtime/module-instruction-stream.grpc.controller.ts`).

No other roadmap item fixes this name inside `telemetry-model.md`. The Phase 12 overview.md fix only targets `docs/realtime/overview.md`. The file rename task at the bottom of Phase 12 only renames the file and updates inbound links — it does not fix stale names within the file.

Since the plan is already touching this file, this is a trivial addition.

**4. Stale service name on line 99 — not addressed**

Line 99 (See Also) references `ModuleInstructionService`, but the correct name is `ModuleInstructionStreamService`. Same situation as above — the Phase 12 protocol.md fix updates `protocol.md` itself, not the reference to it from this file.

### Positive Notes

- Scope is well-defined — two tasks for a focused docs fix.
- Event descriptions are factually accurate: `session_abandoned` = grace period expiry, `session_interrupted` = explicit `activity:stop`.
- Correct instruction to write in Russian, matching the existing document language.
- Timeline diagram update (Task 2) correctly frames the new events as alternative terminal events.
