# Code Review: Add `SessionWatchdogService` periodic sweep

**Plan:** `.ai-factory/plans/66-add-sessionwatchdogservice-periodic-sweep.md`
**Changed files reviewed (in full):**
- `src/realtime/constants/realtime-config.ts`
- `src/realtime/services/activity-engine.service.ts` (Task 2 safety fix)
- `src/realtime/services/session-watchdog.service.ts` (new)
- `src/realtime/realtime.module.ts`

**Risk Level:** 🟢 Low — no correctness, security, or runtime-breaking defects found.

## Summary

The implementation matches the plan precisely. All four tasks landed as specified: two config keys added, the `abandonStale` store-delete guarded by session identity on all three exit branches, a new `SessionWatchdogService` with config-driven `setInterval` scheduling and per-row error isolation, and provider registration in `RealtimeModule`.

## Verified correct

- **Config keys** (`realtime-config.ts:12-13`) — `SESSION_MAX_IDLE_MS` / `SESSION_SWEEP_INTERVAL_MS` follow the existing `WS_`-prefixed style; `as const` preserved.
- **Task 2 safety fix** (`activity-engine.service.ts:196-248`) — the critical concern from plan-review-1 is fully addressed. All three exit paths (`!session` at 198-204, already-finalized at 211-217, post-abandon at 232-235) now read the stored state and delete only when `storedState?.sessionId === sessionId`. This prevents the watchdog from evicting a *different* live session's in-memory entry under the same `userId`. `abandonActivity` was correctly left untouched.
- **Idempotency under double-fire** — the already-finalized guard (`COMPLETED`/`INTERRUPTED`/`ABANDONED`) means a grace-timer + watchdog race, or overlapping sweeps, both land on a safe no-op. Confirmed against `SessionStatus` enum values.
- **Buffer cleanup for DB-only rows** — `abandonStale` pushes the `ABANDONED` stream marker (creating a buffer if absent) then emits `SessionEvents.ABANDONED`; both `StreamEngine.onSessionAbandoned` (`stream-engine.service.ts:196-206`) and the biometric engine handler flush and `buffers.delete`, so no buffer leaks. This is the whole point of routing through the event rather than a bare `repo.update`, and it is done correctly.
- **Query** (`session-watchdog.service.ts:56-61`) — `find({ where: { status: In([ACTIVE, DISCONNECTED]), lastActivityAt: LessThan(threshold) } })` is type-correct (`lastActivityAt` is a non-nullable `Date`, `status` an enum). `In`/`LessThan` imported from `typeorm`. Read-only on `lastActivityAt` — never written. No `isPaused` branching, per spec.
- **Scheduling** — `setInterval` started in `onApplicationBootstrap`, handle typed `ReturnType<typeof setInterval> | undefined`, `clearInterval` guarded in `onApplicationShutdown`. Mirrors `StreamEngine` exactly. The interval callback wraps `sweep()` in `.catch`, so a rejected sweep can't crash the timer.
- **Error isolation** (`session-watchdog.service.ts:68-79`) — each row's `abandonStale` is wrapped in `try/catch`; a failing row logs `error` and the loop continues. `reaped` counts successes only.
- **Logging** — uses `new Logger(SessionWatchdogService.name)`, no `console.*`. Logs only internal UUIDs + idle ms (no PII). Per-reap `warn` + one summary `warn`; silent only when nothing is stale.
- **Registration** (`realtime.module.ts:21,49`) — added to `providers`, not exported. `ModuleSession` repo and `ActivityEngine` already wired. No new migration (no schema change), consistent with note 52 deferring the optional `(status, last_activity_at)` index.

## Non-blocking observations (optional, no change required)

1. **`onApplicationShutdown` only fires if shutdown hooks are enabled.** `app.enableShutdownHooks()` is not called anywhere in `src/`, so on SIGTERM/SIGINT the shutdown timer cleanup won't run. This is harmless here (the process is exiting, and `setInterval` dies with it) and is a pre-existing condition that equally affects `StreamEngine`'s flush-on-shutdown — out of scope for this change. Noted only for awareness; `onApplicationBootstrap` is unaffected and always runs, so the sweep starts correctly.

2. **Unbounded `find`.** The sweep loads all stale rows in one query with no `take` limit. At current scale this is fine (note 52 explicitly defers the index as likely unnecessary). If a large backlog of leaked rows ever accumulated, a batch limit would bound per-sweep work — but the next sweep would pick up the remainder, so there's no correctness risk.

3. **Summary wording on all-failure.** If every stale row throws, the summary logs `Watchdog swept 0 stale sessions` while per-row `error` lines record the failures. Slightly understated but not misleading given the error logs; cosmetic only.

## Conclusion

No bugs, security issues, or runtime-breaking problems. The plan-review-1 correctness concern is resolved. The three observations above are optional hardening notes, not defects.

REVIEW_PASS
