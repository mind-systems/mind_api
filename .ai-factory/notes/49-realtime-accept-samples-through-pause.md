# Realtime: accept instruction + biometric samples through pause

**Date:** 2026-06-19
**Source:** conversation context — mind_mobile Phase 42 (unified session time model) dependency

## Key Findings

- The realtime stream controllers enforce a **module-specific pause policy** that drops user-produced samples while a session is paused, on both tunnels:
  - `module-biometric-stream.grpc.controller.ts:132-139` — `if (session.isPaused === true) → SESSION_PAUSED`, the entire batch is dropped.
  - `module-instruction-stream.grpc.controller.ts:103-115` — `if (session.isPaused && msg.instructionType === StreamDataType.BREATH_PHASE) → SESSION_PAUSED`.
- The `StreamDataType.BREATH_PHASE` literal is the **only domain-specific reference in the generic instruction controller**. `proto/module_instruction_stream.proto:16` documents `instruction_type` as a free, *module-defined* string, and `ActivityType` already spans BREATH + MEDITATION — so hard-coding `=== BREATH_PHASE` is a domain leak into a transport layer that is meant to be module-agnostic. A future module (e.g. `instructionType='pushup_rep'`) would either slip past the guard un-gated or force threading another literal into the generic transport.
- Grep-confirmed: `BREATH_PHASE` is the **only** domain-specific instruction gate in `src/realtime`. `MEDITATION` is lifecycle-only and has no analogous instruction pause gate, so removing the breath gate introduces no cross-module inconsistency. The biometric guard is unconditional (all modules), so its removal is uniform across modules.
- Pause-acceptance policy belongs to the **client**, which owns sample emission and (per mind_mobile Phase 42) the session timeline. The server is bookkeeping-only: it should record any instruction/biometric sample for a **live (non-ended)** session regardless of `isPaused`, storing `data` verbatim into jsonb as today.
- This unblocks mind_mobile notes 123 (stream biometrics through pause) + 124 (`phase='pause'` boundary markers as `breath_phase`) AND removes the domain leak. Without it, both mobile changes are inert/blocked — the resume marker in note 124 is rejected deterministically (on resume the server is still `isPaused=true` and the marker is `breath_phase` → SESSION_PAUSED).
- **No existing test asserts the pause-drop behavior** — grep `SESSION_PAUSED` across `src/` finds only the two controllers plus the unrelated `ws-error-codes` constant and `module-session.events` emitter; there is no controller spec for either stream controller. Nothing breaks on removal, but the new pass-through behavior is therefore uncovered — a regression test is part of this task.
- The docs describe the removed semantics and become **actively wrong** after the change, so they ship in the same milestone: `docs/realtime/biometric-stream.md:13` (precondition "не на паузе") and its whole `## Семантика паузы` section (43-49). A doc that contradicts the code is a defect introduced by this change — doc + test + code share one reason to revert and stay atomic together (not a separate task).

## Details

### The change
1. `src/realtime/module-instruction-stream.grpc.controller.ts` — remove the `if (session.isPaused && msg.instructionType === StreamDataType.BREATH_PHASE) → SESSION_PAUSED` block (lines ~103-115). The `StreamDataType` import (line 21) is used **only** there; remove the import. (`StreamDataType` itself stays in `constants/stream-data-types.ts` — `SESSION_EVENT` is still used by `ActivityEngine`.)
2. `src/realtime/module-biometric-stream.grpc.controller.ts` — remove the `if (session.isPaused === true) → SESSION_PAUSED` block (lines ~132-139).
3. After this, both controllers accept samples for any active (non-ended) session regardless of `isPaused`; the happy-path `streamEngine.push(...)` / batch mapping runs unchanged.
4. **Docs** (same task — they describe the behavior this change inverts; written in Russian per project convention):
   - `docs/realtime/biometric-stream.md` — drop the "не на паузе" precondition (line 13) and rewrite the `## Семантика паузы` section (43-49). New framing: the server accepts any sample for a live (non-ended) session regardless of pause; acceptance policy lives on the client (which owns emission + the session timeline per Phase 42); the server's own `session_event` PAUSED/RESUMED markers remain the authoritative wall-clock lifecycle journal; pause *geometry* is client-owned (`breath_phase` markers carrying `data.offsetMs`). Do **not** describe a `phase='resume'` literal — there is none; on resume the client re-emits the real resumed phase, which closes the pause band (band = `[ phase='pause' marker → next real phase marker ]`).
   - `docs/realtime/protocol.md` — sanity-check the `activity:resume` / pause wording (line ~19) and adjust only if it implies sample rejection on pause.
5. **Regression test** — add a unit test for both stream controllers asserting that a sample submitted while `session.isPaused === true` is forwarded to `streamEngine.push` / `pushBatch` and answered with `ack` (not `SESSION_PAUSED`). Locks in the new pass-through; nothing currently covers it.

### Two-axis pause model (resolved with mind_mobile — informs the doc rewrite)
After removal, pause boundaries exist in two **non-overlapping, by-design-not-joined** representations, distinguishable by row type in `session_stream_samples`:
- Server `session_event` PAUSED/RESUMED — server wall-clock axis (`timestamp`), no `offsetMs`/`phase`. Authoritative lifecycle/status/recovery journal. **Stays — do not touch the server injection.**
- Client `breath_phase` `phase='pause'` — client offset axis (`data.offsetMs`). Timeline geometry consumed by mind_web to render the pause band.

There is **no cross-axis time-join** — eliminating the `clientNow − serverStartedAt` cross-clock skew is the entire point of Phase 42, so the two axes are deliberately not reconciled. mind_web builds the pause band only from `breath_phase`/`offsetMs` rows and ignores `session_event` for geometry. No collision, no duplication concern.

### Guards (do NOT touch)
- The `!sessionId` / `NO_SESSION` / `SESSION_MISMATCH` guards on both controllers.
- `ActivityEngine`'s `SESSION_EVENT` lifecycle injection (`PAUSED`/`RESUMED`/`STARTED`/`ENDED`/…) — still server-stamped, still on the wall-clock axis, unchanged.
- The server-initiated `ready` emit (Phase 37 / note 48), ack/error semantics, and the stream engines (`stream-engine` / `biometric-stream-engine`).
- `StreamDataType` constant definition (only the instruction-controller import is removed).
- No proto change, no schema change.

### Verify
- Drive a session, pause it, and confirm biometrics + a `breath_phase` `phase='pause'` marker now persist (query `session_stream_samples` / `bio_session_samples` by `moduleSessionId`).
- Confirm the stats-finalization path does not choke — but note there is **nothing sample-derived to choke on**. Server stats are **lifecycle-derived**: `stats.service.ts finalise()` computes `durationSeconds = Math.floor(endedAt − startedAt)` and updates `UserStats` (totals / counts / streaks). It injects only the `UserStats` repo, reads no `session_stream_samples` / `bio_session_samples`, and computes no per-sample aggregate (no avg HR). So removing the pause guards corrupts no server aggregate, and `durationSeconds` already includes pause time today (unchanged). Sample segmentation by pause is a **consumer concern** (mind_web), handled via the note-124 markers — not a server task.
- Regression test (change step 5) is green: paused-session sample → `ack`, not `SESSION_PAUSED`, on both controllers.

### Rollout / backward-compat
- The change is backward-compatible. A stray `SESSION_PAUSED` reaching mobile during the rollout window is **non-fatal**: it is an in-band `next({ error })` (not a gRPC stream error), and `ModuleInstructionStream` / `BiometricStreamClient` only `logPrint` it. Risk exists only on a mobile-first / partial deploy and degrades to a logged line.

### Deploy order
- Server (this note) **before** mind_mobile notes 123 / 124. The mobile changes are inert until these guards are removed.

### Cross-repo
- This is the prerequisite dependency for `mind_mobile` notes 123 + 124 (Phase 42).

## Open Questions

- None. The two-axis pause model is confirmed intentional by mind_mobile (see "Two-axis pause model" above): server `session_event` and client `breath_phase` markers live on separate axes with separate consumers, are not time-joined, and the server injection stays as-is. Removing the guards is additive to acceptance (strictly more samples stored); no proto change, no schema change.
