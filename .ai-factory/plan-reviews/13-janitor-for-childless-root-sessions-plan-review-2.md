# Plan Review 2 — Janitor for childless root sessions

**Plan:** `.ai-factory/plans/13-janitor-for-childless-root-sessions.md`
**Risk Level:** 🟢 Low

## Code Review Summary

**Files cross-checked:** 8
- `src/realtime/services/session-watchdog.service.ts` (target)
- `src/realtime/constants/realtime-config.ts`
- `src/realtime/entities/module-session.entity.ts`
- `src/realtime/enums/activity-type.enum.ts`
- `src/migrations/1782658936664-AddRootSessionLink.ts`
- `src/realtime/services/active-stream-registry.service.ts`
- `src/realtime/services/activity-session-store.service.ts`
- `src/realtime/services/activity-engine.service.ts`
- `src/realtime/services/session-watchdog.service.spec.ts` (committed contract)
- `.ai-factory/notes/08-janitor-empty-roots.md` (spec)

Every factual claim in the plan was verified against the real code. The plan is accurate, internally consistent, and fully aligned with both the committed spec note and the committed test suite.

## Verified Assumptions (all correct)

- **Config key exists & is orphaned.** `RealtimeConfig.EMPTY_ROOT_TTL_MS = 'WS_EMPTY_ROOT_TTL_MS'` at `realtime-config.ts:14`. No production consumer today — `sweepEmptyRoots()` becomes the sole reader. ✅
- **Schema prerequisites landed.** `ActivityType.ROOT = 'root'` (`activity-type.enum.ts:4`); nullable self-FK `rootSessionId` with `ON DELETE CASCADE` (`module-session.entity.ts:26-27` + migration `1782658936664` lines 8-12). ✅
- **Cascade reaches bio.** Both `bio_session_samples` (`1779990145496:13`) and `session_stream_samples` (`InitialSchema:293`) FK `moduleSessionId` → `module_sessions(id)` `ON DELETE CASCADE`. Deleting a root row therefore drops its bio — the plan's core "delete, don't abandon" rationale holds. ✅
- **Imports.** `In`, `LessThan`, `SessionStatus`, `RealtimeConfig` already imported (`session-watchdog.service.ts:8,11,14`). `ActivityType` is NOT imported — the plan correctly flags adding `import { ActivityType } from '../enums/activity-type.enum';`. ✅
- **Repo mock surface.** Committed spec exposes only `find`/`count`/`delete` (`spec.ts:51,61-65`). The plan uses exactly `repo.find` / `repo.count({ where: { rootSessionId } })` / `repo.delete({ id })` — no `repo.query`/`repo.exists`, matching the mock. ✅
- **Live-subscriber guard reuse.** `hasLiveSubscriber` returns `(size ?? 0) > 0` (`active-stream-registry.service.ts:34-36`); reused verbatim. ✅
- **Single-timer scheduling.** Lifecycle tests assert exactly one `setInterval(…, 60_000)` whose callback invokes the `sweep` spy (`spec.ts:457-509`). The plan extends the SAME callback with an independently-`.catch()`-guarded `sweepEmptyRoots()` rather than adding a second timer — preserves both assertions. ✅

## Design-Argument Validation (the crux of review 1)

The plan's "in-memory store cleanup is NOT required" note refutes the spec note's "drop the store entry" gotcha. I traced the full disconnect path and the argument is **sound**:

- `DEFAULT_GRACE_MS = 30_000` (`activity-session-store.service.ts:5`) ≪ TTL (600_000 default / 300_000 in spec). ✅
- `handleTransportDisconnect` (`activity-engine.service.ts:630-649`) starts a per-session grace timer that fires `abandonActivity` → `removeSessionFromStore` → `removeRoot` (`:60-66, 278-312`). ✅
- `abandonActivity` sets the row `ABANDONED`, which the candidate query's `status In([ACTIVE, DISCONNECTED])` filter excludes — so a cleanly-graced root is never a janitor candidate, and its store entry is already gone. ✅
- Server-restart edge: grace timer lost, but the in-memory store is empty post-reboot, so no dangling reference can exist for the janitor to invalidate. ✅
- `closeAll` is correctly identified as a no-op under the `!hasLiveSubscriber` guard (`active-stream-registry.service.ts:38-39` returns early when the user has no registered subscribers) and does not touch `ActivitySessionStore`. Omitting it is correct. ✅

The conditional escape hatch (revisit by injecting `ActivitySessionStore.removeRoot` guarded by `getRootId === row.id` if TTL ever drops below grace) is the right boundary to document.

## Test-Contract Tracing

Walked each committed case against the prescribed implementation:
- `spec.ts:329` (reap childless + bio) → `delete({ id })` fires. GREEN. ✅
- `spec.ts:353` (≥1 child never reaped) → `count` returns 1 → skip. GREEN. ✅
- `spec.ts:375` (live subscriber) → `hasLiveSubscriber` true → skip. GREEN. ✅
- `spec.ts:406` (query scope) → `where.activityType === 'root'` + `lastActivityAt LessThan(FIXED_NOW - 300_000)`; mock overrides default to 300_000. GREEN. ✅
- `spec.ts:436` (characterization) → `sweep()` unchanged, `repo.delete` not called. GREEN. ✅
- `spec.ts:491-509` (lifecycle) → `repo.find` resolves `undefined` in this block; `staleRoots.length` throws and is swallowed by the callback's `.catch`. The plan calls this out explicitly (line 54) and the `sweep` spy still records its single call. GREEN. ✅

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** PASS. Change is confined to one service inside the `realtime` module; `ActivityType` is imported from the same module's `enums/`. No cross-module internal imports introduced — modular-monolith boundary respected.
- **Rules (`RULES.md`):** PASS. No non-null assertion (`!`). Logs are lean and ID-only (`sessionId`/`userId`/`idleMs`) — no PII — matching the existing `sweep()` style. Not a gRPC method, so the `@Payload()`/`@GrpcCurrentUser()` rule does not apply.
- **Roadmap (`ROADMAP.md`):** PASS with one note (WARN, non-blocking). The milestone at `ROADMAP.md:46` is the linked task and references spec note `08-janitor-empty-roots.md`. The roadmap wording says "Extend `SessionWatchdog.sweep()`", whereas the plan adds a **sibling** `sweepEmptyRoots()` method. This deviation is intentional and correct — the committed spec (note 08, decision P1) and the committed tests (`spec.ts:436`, `:457-509`) both mandate a separate method so delete/abandon semantics don't mix and `sweep()` stays byte-identical. The plan is superior to the literal roadmap phrasing; no change needed.

## Critical Issues

None.

## Minor Notes (non-blocking, no action required)

- The plan prescribes per-row `warn` on reap. Under a backlog of many stale roots this is slightly chatty, but it mirrors `sweep()`'s existing per-row `warn` at `:79-81` and honors "Keep logs lean" (outcomes only). Consistent — leave as is.
- TOCTOU between `count === 0` and `delete` is correctly assessed as negligible (a new child implies an active stream excluded by `hasLiveSubscriber`) and intentionally non-transactional for a background janitor. Acceptable.

## Positive Notes

- The plan pre-resolves the exact review-1 objection (dangling store reference) with a verifiable code trace rather than hand-waving, and arrives at the correct "do nothing" conclusion with a documented revisit trigger.
- Every call shape is pinned to the committed mock surface, eliminating the classic "guard deeper than the mock sees" trap (it even cites the relevant note).
- Scope discipline is excellent: a single-file change with no new constructor dependency, no migration (none needed — schema already landed), and no perturbation of green characterization/lifecycle tests.

PLAN_REVIEW_PASS
