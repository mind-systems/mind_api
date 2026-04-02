## Code Review: Fix `docs/realtime/telemetry-model.md`

**Plan:** `.ai-factory/plans/54-fix-docs-realtime-telemetry-model-md.md`
**Files Changed:** 1 (`docs/realtime/instruction-model.md`, formerly `telemetry-model.md`)
**Risk Level:** 🟢 Low (documentation only)

### Context Gates

- **ARCHITECTURE.md:** `WARN` — no architectural concerns; docs-only change.
- **RULES.md:** `WARN` — no code rules apply to documentation edits.
- **ROADMAP.md:** OK — maps to Phase 12 item "Fix `docs/realtime/telemetry-model.md`", already checked off.

### Changes Summary

1. Added `session_abandoned` and `session_interrupted` to the `session_event` JSON block (after `session_ended` — correct terminal-event placement).
2. Added explanatory paragraph for the two new events (line 58).
3. Rewrote trigger sentence to cover all lifecycle transitions (line 60).
4. Updated ASCII timeline with alternative terminal events (lines 68–69).
5. Fixed stale class name `ModuleInstructionGrpcController` → `ModuleInstructionStreamGrpcController` (line 87).
6. Fixed stale service name `ModuleInstructionService` → `ModuleInstructionStreamService` (line 105).

### Verification Against Source Code

- `StreamSessionEvent` in `src/realtime/constants/stream-data-types.ts` defines exactly 6 values: `session_started`, `session_ended`, `session_abandoned`, `session_interrupted`, `paused`, `resumed`. Doc now lists all 6. ✅
- `ActivityEngine.abandonActivity()` (line 174) calls `StreamEngine.push()` with `StreamSessionEvent.ABANDONED`. ✅
- `ActivityEngine.stopActivity()` (line 220) calls `StreamEngine.push()` with `StreamSessionEvent.INTERRUPTED`. ✅
- `ModuleInstructionStreamGrpcController` confirmed at `src/realtime/module-instruction-stream.grpc.controller.ts:24`. ✅
- `ModuleInstructionStreamService` confirmed as proto service in `proto/module_instruction_stream.proto:69`. ✅
- See Also links resolve to existing files: `protocol.md`, `session-lifecycle.md`, `database.md`. ✅

### Critical Issues

**1. Line 58 — "(а также при перезапуске сервера)" is factually wrong for the instruction stream**

Line 58 reads:

> `session_abandoned` записывается, когда истекает grace period без переподключения клиента **(а также при перезапуске сервера)**. `session_interrupted` — при явном `activity:stop`.

`StartupRecoveryService.onApplicationBootstrap()` marks orphan sessions as `ABANDONED` in the **database only** — it calls `this.repo.save()` to update `status` and `endedAt`. It does **not** inject or call `StreamEngine.push()`, so no `session_abandoned` instruction sample is written to the instruction stream.

Only `ActivityEngine.abandonActivity()` writes the `session_abandoned` instruction (via `StreamEngine.push()` at line 174), and it is only invoked by the grace period timer callback in `handleTransportDisconnect()`.

Since this document is specifically about the **instruction model** — what gets written to the instruction stream — stating that `session_abandoned` is "written on server restart" is incorrect. On server restart, orphan sessions' instruction streams simply end without a terminal marker.

This was flagged in plan-review-2 but was not addressed during implementation.

**Fix:** Remove the parenthetical. Line 58 should read:

> `session_abandoned` записывается, когда истекает grace period без переподключения клиента. `session_interrupted` — при явном `activity:stop`.

### Suggestions

None.

### Positive Notes

- All six `StreamSessionEvent` values now documented — closes the gap between code and docs.
- Event ordering (start → mid-session → terminal alternatives) is logically sound.
- Timeline diagram clearly shows `session_abandoned` and `session_interrupted` as alternative terminal events.
- Stale class and service names fixed in one pass — prevents the file from needing another patch.
- Written in Russian, matching existing document language.
