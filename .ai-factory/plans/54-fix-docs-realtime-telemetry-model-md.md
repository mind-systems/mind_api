# Plan: Fix `docs/realtime/telemetry-model.md`

## Context
Documentation for `session_event` instruction type lists only four values (`session_started`, `paused`, `resumed`, `session_ended`), while `StreamSessionEvent` in code defines six — missing `session_abandoned` and `session_interrupted`. The timeline diagram is also incomplete, and several class names are stale.

## Settings
- Testing: no
- Logging: minimal
- Docs: yes (this milestone is a docs fix)

## Tasks

### Phase 1: Update documentation

- [x] **Task 1: Add missing events to the `session_event` block and update the trigger sentence**
  Files: `docs/realtime/telemetry-model.md`
  In the `### session_event` section (lines 47–56):
  1. Add `session_abandoned` and `session_interrupted` to the JSON examples **after** `session_ended` — they are terminal events (alternative ways a session ends), so the logical order is: `session_started` → `paused` → `resumed` → `session_ended` → `session_abandoned` → `session_interrupted`.
  2. Add a brief note that `session_abandoned` is written when the grace period expires without reconnection (or on server restart), and `session_interrupted` is written on explicit `activity:stop`.
  3. Update the trigger sentence on line 56 (currently: "Пишется `ActivityEngine` при обработке `activity:start/pause/resume/end`.") to account for the two new triggers — `activity:stop` and grace period expiry. Rewrite to something like: "Пишется `ActivityEngine` при каждом lifecycle-переходе сессии: `activity:start/pause/resume/end/stop` и по истечении grace period."
  Write in Russian — matching the language of the existing document.

- [x] **Task 2: Update the timeline diagram**
  Files: `docs/realtime/telemetry-model.md`
  In the ASCII timeline (line 63), the instruction timeline currently reads:
  `session_started → breath_phase → … → paused → resumed → … → session_ended`
  Add `session_abandoned` and `session_interrupted` as alternative terminal events — e.g. show that a session can end with `session_ended`, `session_abandoned`, or `session_interrupted`. Keep the diagram concise.

- [x] **Task 3: Fix stale class names**
  Files: `docs/realtime/telemetry-model.md`
  1. Line 81: replace `ModuleInstructionGrpcController` with `ModuleInstructionStreamGrpcController` (actual class in `src/realtime/module-instruction-stream.grpc.controller.ts`).
  2. Line 99 (See Also): replace `ModuleInstructionService` with `ModuleInstructionStreamService` (actual class name).
