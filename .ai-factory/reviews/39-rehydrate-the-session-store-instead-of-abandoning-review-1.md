# Code Review: Rehydrate the session store instead of abandoning

**Plan:** `.ai-factory/plans/39-rehydrate-the-session-store-instead-of-abandoning.md`
**Change under review:** `src/realtime/services/startup-recovery.service.ts` (the only code file in the diff)
**Verification run:** `npx jest src/realtime/services/startup-recovery.service.spec.ts` → 8/8 pass. `npx tsc --noEmit` → clean for the changed file.

## Scope

The diff replaces the boot-time bulk-abandon in `StartupRecoveryService.onApplicationBootstrap` with a rehydrate step: load `module_sessions` with `status ∈ {ACTIVE, DISCONNECTED}`, rebuild the `ActivitySessionStore` (roots via `setRoot`, children via `addChild`), derive `isPaused` per child from the last `paused`/`resumed` marker in `session_stream_samples`, persist every row as `DISCONNECTED` with `disconnectedAt = lastActivityAt`, and arm a per-session grace timer from process start that calls `activityEngine.abandonActivity(userId, sessionId)` on expiry. Constructor widened to `(repo, streamSampleRepo, activitySessionStore, activityEngine)`.

## Correctness verification

I read the changed file in full plus its runtime collaborators (`ActivityEngine`, `ActivitySessionStore`, `StreamEngine`, `ModuleStateGrpcController`, the two entities, and the enums/constants). Every load-bearing assumption holds:

- **Persisted marker shape matches the derive.** `StreamEngine.push` stores server markers as `samples: [{ timestamp, serverMarker: true, data: { dataType, event } }]` (immediate-save branch, `stream-engine.service.ts:95-111`). The derive reads `sample.data.event` and `sample.timestamp` — correct against real persisted rows, not just the spec mock. `paused`/`resumed` markers are emitted via `pushSessionEventMarker` with `Date.now()` epoch-ms timestamps, so the `>` comparison orders them correctly.
- **Reconnect cancels the rehydration timers.** On connect, `ModuleStateGrpcController.trackActivity → handleReconnect` cancels each session's grace timer *before* the first `await` and resumes it; `ensureRoot`'s fast path finds the rehydrated root in the store and returns it without minting a duplicate — which is the whole point of the change. Confirmed against `activity-engine.service.ts:604-654` and `module-state.grpc.controller.ts:149-188`.
- **Abandon path is consistent.** Rows are persisted `DISCONNECTED` before timers are armed, so the `abandonActivity` guard (`status === DISCONNECTED`, `activity-engine.service.ts:339`) passes for genuinely-orphaned sessions and no-ops for any that resumed first. `abandonActivity` sets `endedAt = disconnectedAt`, giving the accurate abandon timestamp the plan intends.
- **Closure capture is correct.** The grace `onExpiry` closes over `const session` inside a `for...of` (block-scoped per iteration) — no hoisted-variable capture bug across the multi-user set of rows.
- **No `!`, no PII logging, single lean summary line** — complies with `RULES.md`. No migration needed (`disconnectedAt` already exists on `ModuleSession`); no module wiring change needed (`SessionStreamSample` repo + `ActivityEngine` + `ActivitySessionStore` are already in `RealtimeModule`). No circular DI (`ActivityEngine` does not depend on `StartupRecoveryService`).
- **Ordering is safe.** `onApplicationBootstrap` hooks are awaited during Nest init before the gRPC transport binds, so there is no window where a client can reconnect against a half-built store. The sequential per-child `deriveIsPaused` queries all complete before binding.

## Findings

No correctness, security, or runtime-breakage defects found in the code change.

## Non-blocking observations

1. **Roots are subject to grace-abandon and will emit `SessionEvents.ABANDONED`.** A rehydrated root whose client never returns is abandoned by the same timer, firing the ABANDONED event (→ stream/bio flush + stats listeners). This is **not** introduced here — `ActivityEngine.handleTransportDisconnect` already arms grace + `abandonActivity` for the root in normal operation, so the behavior is consistent with the existing lifecycle. Noted only for awareness.
2. **N+1 `streamSampleRepo.find` — one query per rehydrated child.** This is a one-time bootstrap cost bounded by the number of in-flight children at crash; acceptable for a startup path, not worth optimizing now.
3. **Pre-existing, unrelated tsc errors.** `npx tsc --noEmit` reports three `TS2352` errors in `src/realtime/services/biometric-stream-engine.service.spec.ts`. That file is **not** in this diff and the errors are independent of this change — flagging only so a reader of the typecheck output doesn't attribute them here.

REVIEW_PASS
