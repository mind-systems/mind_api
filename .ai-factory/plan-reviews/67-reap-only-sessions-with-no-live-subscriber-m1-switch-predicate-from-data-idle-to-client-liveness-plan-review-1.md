# Plan Review: Reap only sessions with no live subscriber (M1)

**Plan:** `67-reap-only-sessions-with-no-live-subscriber-m1-switch-predicate-from-data-idle-to-client-liveness.md`
**Files Reviewed:** 4 (plan, registry service, watchdog service, realtime module) + spec note + RULES.md
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`ARCHITECTURE.md` present):** Aligned. Both `ActiveStreamRegistry` and `SessionWatchdogService` live in `RealtimeModule` and are listed providers — the watchdog injecting the registry stays within a single feature module, respecting the modular-monolith boundary. No cross-module internal import is introduced. **OK.**
- **Rules (`RULES.md` present):** Aligned. The suggested `hasLiveSubscriber` body `(this.streams.get(userId)?.size ?? 0) > 0` uses optional chaining + nullish coalescing — it does **not** use the forbidden non-null assertion (`!`). The optional skip log carries `sessionId`/`userId` (IDs, not PII) and is kept minimal, satisfying "keep logs lean" and "never log sensitive data." **OK.**
- **Roadmap (`ROADMAP.md` present):** This is milestone M1 of the Phase 42 watchdog reframe, anchored to spec note `54-watchdog-liveness-proxy-risks.md`. Linkage is explicit; M2/P4 are correctly deferred. **OK.**

## Verification Against Codebase

Every concrete claim in the plan was checked against source and holds:

- **Registry shape** — `active-stream-registry.service.ts:6` is exactly `Map<string, Set<Subscriber<any>>>`, and `deregister` (`:25-32`) deletes the key when the set empties. The proposed existence-or-size check is correct and side-effect free. ✓
- **Watchdog DI** — `session-watchdog.service.ts:24-29` constructor matches the plan; adding `ActiveStreamRegistry` only needs the `import` + a constructor parameter. Both classes are providers in `realtime.module.ts:48-49`, so no `exports`/`imports` wiring is required. ✓
- **Sweep loop** — the `for (const row of staleSessions)` loop (`:68-79`) and the `reaped` counter are as described; a `continue` before `abandonStale` naturally excludes skipped rows from the count and the final summary log (`:81`). ✓
- **`abandonStale` call** — already invoked as `abandonStale(row.userId, row.id)` at `:74`; the plan does not change its signature. ✓
- **Threshold invariant** — confirmed: `DEFAULT_GRACE_MS = 30_000` (`activity-session-store.service.ts:5`, overridable via `WS_RECONNECT_GRACE_MS`) vs. idle default `600_000` (`session-watchdog.service.ts:32`). `MAX_IDLE_MS > RECONNECT_GRACE_MS` holds with 20× margin. ✓

## Observations (non-blocking)

### 1. The registry also holds **sync** subscribers — predicate is broader than the note enumerates (WARN)
The spec note describes "any open stream (control, instruction, or biometric)" as proof the client is live. In practice `SyncStreamGrpcController` **also** registers into the same `ActiveStreamRegistry` (`sync-stream.grpc.controller.ts:49`, registered unconditionally). Since `hasLiveSubscriber` keys on `userId` across all four controllers, a user holding only a long-lived **sync** stream (app foregrounded, browsing history, no active meditation) will cause their stale `module_session` rows to be skipped by the watchdog.

This is still consistent with M1's intent ("a connected client is never reaped") and is benign under one-active-session-per-user + `StartupRecoveryService`, but it means a genuine DB-orphan for an app-open user is reaped only once they fully disconnect, not at the idle threshold. Recommend the implementer is aware that "any subscriber" literally includes sync, and that this is acceptable — not a behavior to special-case in M1.

### 2. Restate the userId-keyed (not sessionId-keyed) decision (minor)
The note explicitly asks to "call it out as an explicit decision" that the predicate keys on `userId`, so a connected user's *unrelated* stale orphan row is skipped while they hold any stream. Task 2's text implies this but does not state it. Worth a one-line note in the implementation/commit so the trade-off is recorded, not rediscovered.

### 3. Per-row skip logging cadence (minor)
The optional skip log is fine at `debug`/`verbose`. Avoid `warn`-level per-skip lines — under a stable connected user a sweep could log a skip every interval, which conflicts with "keep logs lean." The plan already steers toward minimal/verbose, so just honor that.

## Critical Issues

None. No missing migration (this is a pure in-memory predicate change — no schema touch), no incorrect file paths, no wrong API usage, no security concern.

## Positive Notes

- Correctly scopes to M1 only and explicitly defers M2 (`closeAll` race cleanup) and P4 (keepalive env parse), matching the note's milestone decomposition.
- Accurately recognizes that no module-wiring change is needed because both classes already share `RealtimeModule`.
- The proposed `hasLiveSubscriber` guards the empty-set edge case even though `deregister` already prunes empty keys — defensive and rules-compliant (no `!`).
- Threshold semantics are deliberately left untouched, consistent with the note's "the fix is a reframe, not a number."

PLAN_REVIEW_PASS
