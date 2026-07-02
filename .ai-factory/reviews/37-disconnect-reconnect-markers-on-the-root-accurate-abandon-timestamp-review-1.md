# Code Review: Disconnect/reconnect markers on the root + accurate abandon timestamp

**Plan:** `37-disconnect-reconnect-markers-on-the-root-accurate-abandon-timestamp.md`
**Spec:** `.ai-factory/notes/23-connection-loss-markers.md`
**Verdict:** 🟢 No blocking findings.

## Scope of changes

Two source files changed (plan/JSON/plan-review artifacts ignored):

- `src/realtime/constants/stream-data-types.ts` — added `DISCONNECTED: 'disconnected'` and `RECONNECTED: 'reconnected'` to `StreamSessionEvent`.
- `src/realtime/services/activity-engine.service.ts`
  - `pushSessionEventMarker` gained an optional `timestampMs?: number`; `timestamp: timestampMs ?? Date.now()`. `serverMarker: true` preserved.
  - `abandonActivity`: `session.endedAt = session.disconnectedAt ?? now`.
  - `handleReconnect`: captures `reconnectedAt = Date.now()` before the resume loop; after the loop, when `rootId && rootResult`, pushes one `RECONNECTED` marker keyed to `rootId`.
  - `handleTransportDisconnect`: captures `disconnectedAt = Date.now()` before the loop; after the loop, when `rootId`, pushes one `DISCONNECTED` marker keyed to `rootId`.

## Correctness verification

- **Marker persistence path.** Root-keyed markers carry `serverMarker: true` + `dataType === SESSION_EVENT`, so `StreamEngine.push()` routes them to the immediate-persist branch (`sampleRepo.save` keyed by `moduleSessionId`), independent of any buffer or producing client. This is required — a root buffer has no producing client — and is preserved. ✔
- **FK integrity.** Root sessions are real `module_sessions` rows (persisted in `ensureRoot`), so root-keyed `session_stream_samples.moduleSessionId` rows satisfy the existing FK. No migration needed; none is missing. ✔
- **Type of `timestampMs`.** `InstructionSample.timestamp` is typed `number`; `Date.now()` and the new arg are both `number` ms. Consistent. ✔
- **Emit-once on root.** `handleTransportDisconnect` pushes `DISCONNECTED` exactly once after the per-session loop (not inside `onDisconnect`), avoiding per-child spam. `handleReconnect` pushes `RECONNECTED` exactly once, guarded on `rootResult` (set only when the `rootId` session resumes), which also correctly excludes the `clientSessionId` abandonment-confirmation branch (`sessionIds.length === 0`). ✔
- **`rootId && rootResult` guard.** `rootId` is `string | null`; the explicit `rootId &&` keeps the `pushSessionEventMarker(rootId, …)` call provably non-null for the type checker without a non-null assertion (complies with the no-`!` rule). ✔
- **Abandon `endedAt` invariant.** `abandonActivity` only proceeds past the `status !== DISCONNECTED` guard when status is `DISCONNECTED`, which is set exclusively by `onDisconnect`, which sets `disconnectedAt` in the same update. Therefore `disconnectedAt` is guaranteed non-null when the fix path runs; `?? now` is purely defensive. `abandonStale` correctly left untouched. ✔
- **No per-session status transitions changed.** Only root-level timeline markers were added; `SessionStatus` transitions are unchanged. ✔

## Test results

Ran `npx jest src/realtime/services/activity-engine.service.spec.ts`: **43 passed, 2 failed**.

- The three TDD tests for this milestone all pass:
  - `handleTransportDisconnect emits exactly one disconnected event keyed to rootId — never per-child`
  - `handleReconnect emits exactly one reconnected event keyed to rootId`
  - `abandonActivity uses disconnectedAt as endedAt — not now — for a DISCONNECTED session`
- The 2 failures (`pause integrity across resume — RED until spec 24-pause-state-integrity`, Cases A & B) belong to a **separate future milestone (spec 24)**. They live in the already-committed spec file and test `resumeActivity`/`unpauseActivity` `isPaused` behavior — logic this diff does not touch (`git diff HEAD` shows no change to `resumeActivity`, `unpauseActivity`, `isPaused`, or `NOT_PAUSED`; the only match is the existing `resumeActivity` call site as context). These are pre-existing intentional RED tests, not a regression from this change.

## Non-blocking observations

1. **Disconnect/reconnect marker asymmetry on a vanished root row.** If `rootId` is in the store but `resumeActivity` returns null on reconnect (e.g. the root DB row was deleted), a `DISCONNECTED` marker will have been emitted with no matching `RECONNECTED`. This is an unreachable-in-practice edge (root rows are not deleted), and timeline readers must already tolerate unmatched markers (disconnect → abandon has no reconnect). Not worth guarding.

2. **Marker timestamp vs. per-session `disconnectedAt` (cosmetic).** The root `DISCONNECTED` marker uses one pre-loop `Date.now()`, while each session's `disconnectedAt` is a separate `new Date()` inside `onDisconnect` — a few ms apart. Does not affect the spec's verify criteria (which compares `endedAt` to `session.disconnectedAt`). Not worth reconciling.

REVIEW_PASS
