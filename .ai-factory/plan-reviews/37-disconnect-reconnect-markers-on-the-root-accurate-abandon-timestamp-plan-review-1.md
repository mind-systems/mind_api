# Plan Review: Disconnect/reconnect markers on the root + accurate abandon timestamp

**Plan:** `37-disconnect-reconnect-markers-on-the-root-accurate-abandon-timestamp.md`
**Spec:** `.ai-factory/notes/23-connection-loss-markers.md`
**Risk Level:** 🟢 Low

## Summary

Files Reviewed: 7 (plan, spec note, `activity-engine.service.ts`, `stream-engine.service.ts`, `activity-session-store.service.ts`, `module-session.entity.ts`, `session-stream-sample.entity.ts`, plus specs & migrations for impact).

The plan is accurate, additive, and correctly grounded in the code. Every file path, method name, signature, and field it references exists and behaves as the plan assumes. No migration is required and none is missing. No blocking issues.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** Not read in depth, but the change stays within the `realtime` module's existing services and respects module ownership (`@InjectRepository` used only inside owning services; markers routed through `StreamEngine`). No boundary violation. — WARN: none.
- **Rules (`.ai-factory/RULES.md`):** Logging is via NestJS `Logger` (plan leaves log lines unchanged / minimal-logging setting). No `console.*` introduced. — WARN: none.
- **Roadmap:** This is a scoped feature; linkage to a ROADMAP milestone was not verified here. If tracked, ensure the milestone is referenced. — WARN (non-blocking): confirm roadmap linkage.
- **skill-context (`aif-review/SKILL.md`):** Not present — no project-specific overrides to apply.

## Verification of Key Assumptions (all confirmed)

- **Task 1** — `StreamSessionEvent` at `constants/stream-data-types.ts` is a free-form `as const` object backing a jsonb `event` field. Adding `DISCONNECTED`/`RECONNECTED` is purely additive; no proto, no reader, no producer change. ✔
- **Task 2** — `pushSessionEventMarker(sessionId, event)` is private, used only within `activity-engine.service.ts`, and hardcodes `timestamp: Date.now()` with `serverMarker: true`. Adding an optional 3rd `timestampMs?: number` is backward-compatible; `InstructionSample.timestamp` is typed `number`, so a ms number is the correct type. ✔
- **serverMarker persistence path** — `StreamEngine.push()` routes `serverMarker === true && dataType === SESSION_EVENT` into the immediate-persist branch (`sampleRepo.save` keyed by `moduleSessionId`), independent of any in-memory buffer or producing client. Preserving `serverMarker: true` is genuinely required for a root-keyed marker to persist. ✔
- **Task 3 (disconnect)** — `handleTransportDisconnect` already resolves `rootId` at the top and it survives the loop (entries stay in the store during grace). Pushing one marker to `rootId` after the loop, keyed off a single pre-loop `Date.now()`, matches the spec's "once on the root, at the drop instant." Root is included in the per-session loop, so its status transition is untouched as required. ✔
- **Task 3 (reconnect)** — `handleReconnect` sets `rootResult` only when the `rootId` session resumes; guarding the RECONNECTED push on `rootResult != null` correctly (a) fires once on the root and (b) skips the `clientSessionId` abandonment-confirmation branch where `sessionIds.length === 0`. Return value `soleChildResult ?? rootResult ?? null` is left intact. ✔
- **Task 4 (abandon)** — `ModuleSession.disconnectedAt` exists (`Date | null`), is set by `onDisconnect`, and the `status !== DISCONNECTED` guard guarantees it is populated when abandon proceeds, so `session.endedAt = session.disconnectedAt ?? now` yields the accurate instant. `abandonStale` is correctly left alone. ✔
- **No migration needed** — `session_stream_samples.moduleSessionId` has an existing FK to `module_sessions(id)` (`InitialSchema`). Root sessions are real `module_sessions` rows (persisted in `ensureRoot`), so root-keyed marker rows satisfy the FK. Reuses existing tables; no schema change. ✔
- **Existing tests remain green** — The `abandonActivity` spec asserts only `endedAt` `toBeDefined()`; with the fixture not setting `disconnectedAt` it falls back to `now`, still defined. The `handleReconnect (a)` spec uses a child-only store (no root), so `rootResult` stays null and no RECONNECTED marker is pushed — the new guard is compatible. ✔

## Non-Blocking Observations

1. **Enum value naming inconsistency (pre-existing, intentional here).** Existing values mix conventions: `STARTED='session_started'`, `ENDED='session_ended'`, `ABANDONED='session_abandoned'`, `INTERRUPTED='session_interrupted'`, but `PAUSED='paused'`, `RESUMED='resumed'`. The plan's `DISCONNECTED='disconnected'` / `RECONNECTED='reconnected'` follows the unprefixed `PAUSED`/`RESUMED` style and matches the spec verbatim. This is fine, but timeline readers must key off these literal unprefixed strings — worth keeping in mind for the web/coach consumers.

2. **Marker timestamp vs. per-session `disconnectedAt` (cosmetic).** Task 3 uses one pre-loop `Date.now()` for the root marker, while each session's `disconnectedAt` is a separate `new Date()` inside `onDisconnect`, so the marker and the abandon `endedAt` differ by a few ms. This does not affect the spec's verify criteria (which compares `endedAt` to `disconnectedAt`, both from Task 4's `session.disconnectedAt`) and is not worth reconciling.

3. **Suggested (optional) implementation guard for reconnect.** When pushing the RECONNECTED marker, guard on `rootId && rootResult` rather than `rootResult` alone, so the `pushSessionEventMarker(rootId, ...)` call site is provably non-null for TypeScript (`rootId` is `string | null`). Functionally `rootResult != null` already implies `rootId` is truthy, but the explicit check keeps the type checker happy without a non-null assertion.

## Positive Notes

- Correctly isolates the root-level *marker* (analytics) from per-session *status* transitions (internal) — exactly the distinction the spec calls out as a gotcha.
- Correctly identifies that the marker must be emitted at the connection-level handler, not per-session `onDisconnect`, avoiding timeline spam.
- Correctly recognizes the `serverMarker: true` immediate-persist mechanism as the reason root-keyed markers persist without a producing client.
- Task dependencies (Task 2→3, 1→3, 1→4) are ordered correctly.

PLAN_REVIEW_PASS
