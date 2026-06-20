# Code Review: Reap only sessions with no live subscriber (M1)

## Code Review Summary

**Files Reviewed:** 2 code files (`active-stream-registry.service.ts`, `session-watchdog.service.ts`) + module/context verification
**Risk Level:** 🟢 Low

### Context Gates

- **Architecture (`ARCHITECTURE.md` present):** Aligned. Both `ActiveStreamRegistry` and `SessionWatchdogService` are providers in `RealtimeModule` (`realtime.module.ts:48-49`). The watchdog injecting the registry stays within a single feature module — no cross-module internal import is introduced. **OK.**
- **Rules (`RULES.md` present):** Aligned.
  - No non-null assertion: `hasLiveSubscriber` uses `(this.streams.get(userId)?.size ?? 0) > 0`. **OK.**
  - No sensitive data in logs: the new verbose log emits `sessionId`/`userId` only — IDs, not PII. **OK.**
  - Keep logs lean: skip log is at `verbose` (not `warn`), single line. **OK.**
- **Roadmap:** This is M1 of the watchdog liveness reframe (spec note `54`). M2 (`closeAll` on residual reap) and P4 (keepalive env) are explicitly deferred per the plan. Linkage explicit. **OK.**

### Correctness Verification

- **DI / wiring:** `ActiveStreamRegistry` added to the constructor (`session-watchdog.service.ts:29`) with `import` at `:13`. Both are registered providers in the same module; `ActiveStreamRegistry` has no constructor dependencies, so no circular-dependency risk. ✓
- **Type safety:** `row.userId` is `string`; `hasLiveSubscriber(userId: string)` matches. ✓
- **Predicate logic:** `deregister` deletes the key when its `Set` empties (`:29-31`), so an existence check suffices; the `?? 0 > 0` guard additionally covers any transient empty-set state. Side-effect free. ✓
- **Sweep loop:** the `continue` is placed before `abandonStale`, so skipped rows never reach the reaper and are naturally excluded from the `reaped` counter and the final summary log. ✓
- **No migration / schema touch:** pure in-memory predicate change. Nothing to migrate. ✓

### Critical Issues

None. No bugs, no runtime breakage, no security concern.

### Observations (non-blocking, intended behavior)

1. **Predicate is `userId`-keyed and includes all stream types.** Because `ActiveStreamRegistry` is shared across control/instruction/biometric/sync controllers and keyed on `userId`, a user holding *any* live stream (including a long-lived sync stream while the app is merely foregrounded) will cause *all* their stale `module_session` rows to be skipped — including a genuine DB-orphan unrelated to the active stream. Such an orphan is then reaped only after the client fully disconnects, not at the idle threshold. This matches M1's stated intent ("a connected client is never reaped") and is benign under one-active-session-per-user + `StartupRecoveryService`. Noted for the record, not a defect to fix in M1.

2. **Inherent check-then-act window.** A subscriber could register between `hasLiveSubscriber` returning `false` and `abandonStale` running. This race is pre-existing/acceptable for an in-memory liveness proxy and is not introduced or worsened by this change.

### Positive Notes

- Minimal, well-scoped change that exactly implements the plan; no gold-plating.
- Rules-compliant predicate (no `!`, empty-set guard) even though `deregister` already prunes empty keys — defensive.
- Logging stays lean and at the correct level; threshold semantics deliberately untouched.

REVIEW_PASS
