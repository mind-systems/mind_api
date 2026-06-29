# Code Review — Update realtime docs to root/child model

**Scope:** documentation milestone. The changes rewrite `docs/realtime/*` (overview, session-lifecycle, instruction-model, biometric-stream, database, protocol) and `docs/stats/stats.md` from the old single-session model to the shipped root-timeline + overlapping-children model. Correctness here means each doc accurately describes the *implemented current behavior*.

I ran `git status` / `git diff HEAD`, read every changed doc in full at its current state, and cross-checked all load-bearing claims against the implementation:
- `module-state.grpc.controller.ts`, `module-biometric-stream.grpc.controller.ts`, `module-instruction-stream.grpc.controller.ts`
- `activity-engine.service.ts`, `activity-session-store.service.ts`, `stream-engine.service.ts`, `biometric-stream-engine.service.ts`, `session-watchdog.service.ts`
- `stats.worker.ts`, `stats.service.ts`
- `ws-error-codes.ts`, the `module_state` / `module_biometric_stream` protos, and the `.env*` files.

## Verification results — all accurate

- **Root/child model** (overview.md, session-lifecycle.md): one lazy root + N concurrent children, root never closed by `activity:end`, root→`abandoned` on grace or janitor reap. Matches `ensureRoot` (idempotent, always returns a root), `startActivity` (child carries `rootSessionId`), and per-`sessionId` grace timers in `handleTransportDisconnect`.
- **Root-id delivery to client** (biometric-stream.md:13,30; protocol.md:42): correctly limited to `session:state.moduleSessionId` on reconnect when no active child exists — matches `handleReconnect` returning `rootResult` only when `soleChildResult` is null. No false "delivered at connect" claim.
- **Bio ingest** (biometric-stream.md): `session_id` must equal the root id; `NO_ROOT_SESSION` framed as a defensive guard (consistent with `ensureRoot` never returning null); `SESSION_MISMATCH` for a non-root id; batch-consistency rules (empty batch / missing `session_id` / inconsistent `session_id` / missing `sample_type`) match the controller's step 1–4 ordering and `INVALID_ARGUMENT` codes.
- **Bio flush triggers** (biometric-stream.md, database.md): periodic timer, root `abandoned`, and shutdown — the triggers that actually act on the root-keyed buffer. The misleading "flush on revoke" claim is gone.
- **Pause semantics** (instruction-model.md:58, biometric-stream.md): the server does **not** filter `breath_phase` during pause; pause policy is client-owned; the server only stamps `paused`/`resumed`. Matches the instruction controller and `StreamEngine.push` (neither has pause logic) and is now internally consistent across the two docs.
- **Instruction routing under concurrency** (instruction-model.md:9): correctly notes the instruction stream targets the single active practice and is not routed by `session_id` among multiple children — matches `getSoleChild` (returns `undefined` unless exactly one child).
- **State protocol** (protocol.md): optional `session_id` routing (explicit → sole child → `AMBIGUOUS_SESSION`) matches `resolveTargetSession`; `client_activity_id` short-window idempotency matches `handleActivityStart`; rate-limit applies only to `activity:start`. Pause error codes (`no_active_session`, `already_paused`, `not_paused`) match the lowercase `WsErrorCode` constants.
- **Schema** (database.md): `root` activity type (server-internal), nullable `rootSessionId` FK `ON DELETE CASCADE` + index, bio `moduleSessionId` → root, instruction samples → child, windowed time-join `(rootSessionId, ts ∈ [child.startedAt, child.endedAt])`, and `lastActivityAt` updated by both instruction batches (child) and the bio flush (root). All match the entities, engines, and watchdog.
- **Stats** (stats.md): root exclusion attributed to `StatsService.finalise` (line 41), not `StatsWorker` — correct. Qualifying-duration, streak, and smoothing rules unchanged and accurate.
- **Config** (configuration.md): `WS_EMPTY_ROOT_TTL_MS` default `600000` matches the watchdog fallback; `WS_RECONNECT_GRACE_MS` applies independently to root and each child, matching `handleTransportDisconnect`. The janitor's "bio alone does not protect a root" is accurate — `sweepEmptyRoots` gates on `childCount` of `rootSessionId`, which stored bio rows never raise.
- **Doc hygiene:** all `## See Also` footers removed; no prev/next nav; no file trees; Russian throughout, matching neighboring style.

No bugs, contradictions, or inaccuracies remain. The eight findings raised across earlier review cycles (root-id delivery, stats-guard attribution, `NO_ROOT_SESSION`/acceptance-gate, flush-on-revoke, `WS_EMPTY_ROOT_TTL_MS` default, `lastActivityAt` bio update, pause-blocking claim, concurrent-instruction over-promise) are all fixed and re-verified against the code.

REVIEW_PASS
