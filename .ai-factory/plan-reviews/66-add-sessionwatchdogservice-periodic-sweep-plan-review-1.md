# Plan Review: Add `SessionWatchdogService` periodic sweep

**Plan:** `.ai-factory/plans/66-add-sessionwatchdogservice-periodic-sweep.md`
**Files Reviewed:** 1 plan + 8 source files cross-checked
**Risk Level:** 🟡 Medium

The plan is well-researched and most of its codebase claims check out exactly. Line references are accurate, the chosen integration points exist, and the core staleness assumption holds. One real correctness concern (narrow but silent) and a few hardening notes follow.

## Context Gates

- **ARCHITECTURE.md** — present. Plan keeps work inside the `realtime` module, reuses existing module-owned providers (`ActivityEngine`, `ModuleSession` repo via `TypeOrmModule.forFeature`), and does not cross module boundaries. No `@InjectRepository` of a foreign entity. ✅ Aligned. **WARN:** none.
- **RULES.md** — present. Checked against all four rules:
  - No non-null assertion: the planned log uses `row.lastActivityAt.getTime()`; `lastActivityAt` is a non-nullable column (`module-session.entity.ts:41-42`), so no `!` is required. ✅
  - No sensitive data in logs: plan logs `sessionId`, `userId` (internal UUIDs), and idle ms — no email/token/PII. ✅
  - Lean logs: per-reap `warn` + one summary `warn`. Reaps are rare events and are key business outcomes, so this is consistent with the rule (warn on outcome, not entry/exit). ✅
  - `@Payload()` rule: not applicable (no gRPC method added). ✅
  - **WARN:** none.
- **ROADMAP.md** — present. This is a `fix`/defense-in-depth backstop derived from a production incident (note 52). **WARN:** the plan does not reference a ROADMAP milestone or the incident linkage; consider noting the roadmap/incident anchor for traceability. Non-blocking.
- **skill-context** (`.ai-factory/skill-context/aif-review/`) — not present. No project-specific review overrides to apply.

## Verified Assumptions (correct)

- `RealtimeConfig` key style (`realtime-config.ts`) matches the Task 1 additions (`as const`, `WS_`-prefixed string values). ✅
- `StreamEngine` constructor + `onApplicationBootstrap`/`onApplicationShutdown` `setInterval`/`clearInterval` pattern exists exactly at the cited lines and is a sound template. ✅
- The reasoning that `@Interval` cannot read a `ConfigService` value (decorator evaluated at class-load before DI) is correct; the `setInterval`-in-bootstrap approach is the right way to honor `WS_SESSION_SWEEP_INTERVAL_MS`. `ScheduleModule.forRoot()` is registered (`app.module.ts:37`), so the `@Interval` fallback would also work. ✅
- `ActivityEngine.abandonStale(userId, sessionId)` already exists (`activity-engine.service.ts:196-239`), has no `DISCONNECTED` guard, no-ops on already-finalized rows, and emits `SessionEvents.ABANDONED`. The plan correctly says to reuse it — Task 2 does **not** need to author it. ✅
- Both stream engines subscribe to `SessionEvents.ABANDONED` (`stream-engine.service.ts:196`, `biometric-stream-engine.service.ts:216`), so the buffer-flush-and-drop claim is accurate. ✅
- **Critical staleness assumption holds:** `lastActivityAt` is written on every persisting flush in *both* engines (`stream-engine.service.ts:164`, `biometric-stream-engine.service.ts:184`), flush cadence ~5s. A legitimately active or paused-but-connected session keeps advancing the timestamp, so the 10-min threshold will not falsely reap a live session. The "no pause special-casing" reasoning is sound. ✅
- Module registration: `ModuleSession` is on `forFeature` (`realtime.module.ts:25-29`), `ActivityEngine` is already a provider; adding `SessionWatchdogService` to `providers` and not exporting it is correct. ✅
- No migration required — no schema change. The optional `(status, last_activity_at)` index is correctly deferred (note 52 §Concurrency). ✅

## Critical Issues

None that block, but one correctness concern that should be addressed before implementation:

### 1. Watchdog can silently kill a healthy in-memory session for the same user (Medium)

`abandonStale` ends with an **unconditional** `this.activitySessionStore.delete(userId)` (`activity-engine.service.ts:226`). The store is keyed by `userId`, not `sessionId`. The watchdog sweeps arbitrary DB rows by `userId`, so consider this reachable sequence:

1. A stale `ACTIVE` row `S1` exists for user `U` with **no** matching in-memory entry — exactly the "row missed by startup recovery / silent orphan" case this watchdog targets (note 52 §Design explicitly lists it).
2. `U` opens a new stream and starts a fresh session `S2`. `handleActivityStart` only guards on `getActiveSession(userId)` (the in-memory store, `module-state.grpc.controller.ts:261`), which is empty, so `S2` is created. Now `U` has two `ACTIVE` DB rows and one in-memory entry pointing at `S2`.
3. After `maxIdleMs`, the watchdog reaps `S1` → `abandonStale(U, S1)` → finalizes `S1` correctly, then `activitySessionStore.delete(U)` — which deletes the entry for the **live** `S2`, silently terminating a healthy session.

The window is narrow (requires an orphan row plus a new session for the same user), but the failure is silent and defeats the watchdog's purpose (it should reap dead sessions, not live ones). Note 52 acknowledges the DB-only-row case but assumes the store delete is harmless; it does not consider a *different* live session under the same `userId`.

**Recommended mitigation:** guard the store delete by session identity. The plan's instruction "reuse `abandonStale` as-is" should be relaxed to allow a one-line safety change — only clear the in-memory entry when it actually points at the reaped session:

```ts
const state = this.activitySessionStore.get(userId);
if (state?.sessionId === sessionId) {
  this.activitySessionStore.delete(userId);
}
```

This is also safe for the existing grace-timer path (there the stored sessionId always matches). Alternatively, gate the delete in the watchdog before calling `abandonStale`, but fixing it inside `abandonStale` covers both callers. Please call this out as an explicit sub-task rather than "reuse as-is."

## Suggestions (non-blocking)

### 2. Per-row error isolation in the sweep loop
The plan loops over rows and `await this.activityEngine.abandonStale(...)` for each. If one row's abandon throws (DB hiccup, event-handler error), the loop aborts and the remaining stale rows are skipped until the next sweep. Wrap each row in a `try/catch`, log the failure, and continue; compute the summary count from successful reaps. This keeps one bad row from blocking the rest of the batch.

### 3. Timer field typing and shutdown guard
When mirroring `StreamEngine`, type the handle as `ReturnType<typeof setInterval> | undefined` and guard `clearInterval` with an `undefined` check in `onApplicationShutdown` (as `stream-engine.service.ts:37,76-81` does). The plan says "mirror `StreamEngine`," which is correct — just make this explicit so the implementer doesn't reach for `NodeJS.Timeout` or skip the guard.

### 4. Sweep-interval vs. idle-threshold relationship
Defaults are sweep 60s, idle 600s — fine. Worth a one-line note in the plan that the sweep interval should remain ≪ the idle threshold so reaping latency stays bounded; no code change needed.

## Positive Notes

- Excellent grounding: every cited file/line reference I checked was accurate, including the non-obvious claim that `abandonStale` already exists and routes through both engines.
- The hardest correctness question — whether a long, legitimately-active session could be falsely reaped — was correctly resolved by identifying that flushes drive `lastActivityAt`, and the pause analysis (Phase 49 biometrics-through-pause) is right.
- Task dependencies (1 → 2 → 3) are correctly ordered, and the registration step accurately notes the repo and `ActivityEngine` are already wired.

## Verdict

Solid plan with accurate codebase grounding. Address concern #1 (guard the in-memory store delete by sessionId) as an explicit sub-task before implementing; fold in suggestions #2–#4 if convenient.
