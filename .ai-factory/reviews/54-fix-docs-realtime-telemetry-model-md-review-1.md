## Code Review: Fix `docs/realtime/telemetry-model.md`

**Plan:** `.ai-factory/plans/54-fix-docs-realtime-telemetry-model-md.md`
**Files Changed:** 1 (`docs/realtime/telemetry-model.md`)
**Risk Level:** 🟢 Low (documentation only)

### Changes Summary

1. Added `session_abandoned` and `session_interrupted` to the `session_event` JSON block (after `session_ended` — correct terminal-event placement).
2. Added explanatory paragraph for the two new events.
3. Rewrote trigger sentence to cover all lifecycle transitions.
4. Updated ASCII timeline with alternative terminal events.
5. Fixed stale class name `ModuleInstructionGrpcController` → `ModuleInstructionStreamGrpcController` (line 87).
6. Fixed stale service name `ModuleInstructionService` → `ModuleInstructionStreamService` (line 105).

### Verification Against Source Code

- `StreamSessionEvent` in `src/realtime/constants/stream-data-types.ts` defines exactly 6 values: `session_started`, `session_ended`, `session_abandoned`, `session_interrupted`, `paused`, `resumed`. Doc now lists all 6. ✅
- `ModuleInstructionStreamGrpcController` class confirmed in `src/realtime/module-instruction-stream.grpc.controller.ts:24`. ✅
- `ModuleInstructionStreamService` confirmed as proto service name in `proto/module_instruction_stream.proto`. ✅
- See Also links resolve to existing files: `protocol.md`, `session-lifecycle.md`, `database.md`. ✅

### Issues

**1. Line 58 — "а также при перезапуске сервера" is inaccurate for the instruction stream**

Line 58 reads:

> `session_abandoned` записывается, когда истекает grace period без переподключения клиента **(а также при перезапуске сервера)**.

This was flagged in plan-review-2 as incorrect, but the implementation did not address it.

`StartupRecoveryService.onApplicationBootstrap()` marks orphan sessions as `ABANDONED` **in the database only** (updates `status` and `endedAt`). It does **not** call `StreamEngine.push()` — no `session_abandoned` instruction sample is written to the stream.

Only `ActivityEngine.abandonActivity()` writes to the instruction stream (via `StreamEngine.push()`), and it is only invoked by the grace period timer.

Since this document is specifically about the **instruction model** (what gets written to the instruction stream), stating that `session_abandoned` is "written on server restart" is factually wrong. On server restart, those sessions' instruction streams simply end without a terminal marker.

**Fix:** Remove the parenthetical. Line 58 should read:

> `session_abandoned` записывается, когда истекает grace period без переподключения клиента. `session_interrupted` — при явном `activity:stop`.

### Positive Notes

- All four issues from plan-review-1 were correctly addressed.
- Event ordering (start → mid → terminal alternatives) is logically sound.
- Timeline diagram is concise and clear.
- Stale class names fixed — prevents the file from needing another patch.
- Written in Russian, matching existing document language.

REVIEW_PASS
